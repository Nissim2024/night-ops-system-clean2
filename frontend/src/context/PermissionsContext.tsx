import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// can(key) answers from the caller's EFFECTIVE permissions (role + teams,
// module grants expanded server-side - GET /permissions/me, 2026-10-05).
// Module keys:   can('partial:module:x') = any part of module x is granted
//                can('module:x')         = the whole module
// Pre-catalog keys still resolve, so older call sites keep working.
const LEGACY: Record<string, string> = {
  'screen:qa': 'partial:module:qa',
  'screen:release-intelligence': 'partial:module:release-intelligence',
  'screen:quality-hub': 'partial:module:quality-hub',
  'screen:defects': 'defects:view',
};

interface PermissionsContextType {
  allPermissions: Record<string, string[]>;
  effective: string[];
  can: (permission: string) => boolean;
  reload: () => Promise<void>;
  saving: boolean;
  updateRole: (role: string, permissions: string[]) => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType>({
  allPermissions: {},
  effective: [],
  can: () => false,
  reload: async () => {},
  saving: false,
  updateRole: async () => {},
});

export const usePermissions = () => useContext(PermissionsContext);

interface Props {
  token: string;
  role: string;
  children: React.ReactNode;
}

export const PermissionsProvider: React.FC<Props> = ({ token, role, children }) => {
  const [allPermissions, setAllPermissions] = useState<Record<string, string[]>>({});
  const [effective, setEffective] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const reload = useCallback(async () => {
    try {
      const [all, me] = await Promise.all([
        axios.get(`${API}/permissions`, { headers }),
        axios.get(`${API}/permissions/me`, { headers }),
      ]);
      setAllPermissions(all.data);
      setEffective(Array.isArray(me.data) ? me.data : []);
    } catch {}
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reload(); }, [reload]);

  const can = useCallback(
    (permission: string) => {
      if (role === 'ADMIN') return true;
      const key = LEGACY[permission] ?? permission;
      return effective.includes(key);
    },
    [effective, role],
  );

  const updateRole = async (targetRole: string, permissions: string[]) => {
    setSaving(true);
    try {
      await axios.put(`${API}/permissions/${targetRole}`, { permissions }, { headers });
      await reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <PermissionsContext.Provider value={{ allPermissions, effective, can, reload, saving, updateRole }}>
      {children}
    </PermissionsContext.Provider>
  );
};

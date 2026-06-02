import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface PermissionsContextType {
  allPermissions: Record<string, string[]>;
  can: (permission: string) => boolean;
  reload: () => Promise<void>;
  saving: boolean;
  updateRole: (role: string, permissions: string[]) => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType>({
  allPermissions: {},
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
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const reload = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/permissions`, { headers });
      setAllPermissions(res.data);
    } catch {}
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reload(); }, [reload]);

  const can = useCallback(
    (permission: string) => (allPermissions[role] ?? []).includes(permission),
    [allPermissions, role],
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
    <PermissionsContext.Provider value={{ allPermissions, can, reload, saving, updateRole }}>
      {children}
    </PermissionsContext.Provider>
  );
};

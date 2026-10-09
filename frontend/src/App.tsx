import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Login } from './components/Login';
import { ManagerDashboard } from './components/ManagerDashboard';
import { EmployeeDashboard } from './components/EmployeeDashboard';
import { PermissionsProvider } from './context/PermissionsContext';
import { DialogProvider } from './context/DialogContext';
import { UnsavedChangesProvider } from './context/UnsavedChangesContext';
import { ErrorBoundary } from './components/ErrorBoundary';
const API_URL = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// Deep link (e.g. from a "copy Home to email" link): ?go=ri-home&versionId=<id>.
// Read once at load, then strip from the URL so a refresh doesn't re-fire it.
// Survives the login screen because it lives in App state, not the URL.
const initialDeepLink: { go: string; versionId?: string } | null = (() => {
  try {
    const p = new URLSearchParams(window.location.search);
    const go = p.get('go');
    if (!go) return null;
    return { go, versionId: p.get('versionId') || undefined };
  } catch { return null; }
})();

function App() {
  const [token, setToken] = useState<string | null>(
    localStorage.getItem('deploycenter_token')
  );
  const [deepLink, setDeepLink] = useState(initialDeepLink);

  useEffect(() => {
    if (initialDeepLink) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const handleLogin = (newToken: string) => {
    localStorage.setItem('deploycenter_token', newToken);
    setToken(newToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('deploycenter_token');
    localStorage.removeItem('deploycenter_fullName');
    setToken(null);
  };

  // The app has no client-side routing — every screen/tab is internal React state,
  // not a URL. Without this, the browser's BACK button navigates away from the app's
  // single history entry entirely, which looks to the user like being logged out.
  // Trap BACK on the current entry instead — in-app navigation already has its own
  // "back" affordances (sidebar, breadcrumbs, close buttons).
  useEffect(() => {
    if (!token) return;
    window.history.pushState(null, '', window.location.href);
    const onPopState = () => window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [token]);

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  const payload = JSON.parse(atob(token.split('.')[1]));
  // VIEWER → ManagerDashboard (read-only via permissions), EMPLOYEE → EmployeeDashboard
  const isManager = ['ADMIN', 'RELEASE_MANAGER', 'CR_MANAGER', 'TEAM_LEAD', 'VIEWER'].includes(payload.role);

  return (
    <ErrorBoundary>
      <DialogProvider>
        <UnsavedChangesProvider>
          <PermissionsProvider token={token} role={payload.role}>
            {isManager
              ? <ManagerDashboard token={token} onLogout={handleLogout} deepLink={deepLink} onDeepLinkConsumed={() => setDeepLink(null)} />
              : <EmployeeProjectGate qcProject={payload.qcProject ?? null} onLogout={handleLogout}>
                  <EmployeeDashboard token={token} onLogout={handleLogout} />
                </EmployeeProjectGate>
            }
          </PermissionsProvider>
        </UnsavedChangesProvider>
      </DialogProvider>
    </ErrorBoundary>
  );
}

// Multi-project phase 1 (2026-10-09): the employee screen shows the default
// project's versions/tasks only, so an employee logged in to another QC
// project gets an explanation instead of the wrong project's data.
const EmployeeProjectGate: React.FC<{ qcProject: string | null; onLogout: () => void; children: React.ReactNode }> = ({ qcProject, onLogout, children }) => {
  const [secondary, setSecondary] = useState<{ displayName: string } | null | undefined>(qcProject ? undefined : null);
  useEffect(() => {
    if (!qcProject) return;
    axios.get(`${API_URL}/auth/qc-projects`)
      .then(r => { const p = (r.data ?? []).find((x: any) => x.key === qcProject); setSecondary(p && !p.isDefault ? { displayName: p.displayName } : null); })
      .catch(() => setSecondary(null));
  }, [qcProject]);
  if (secondary === undefined) return null;
  if (!secondary) return <>{children}</>;
  return (
    <div dir="rtl" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 460, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 40 }}>📁</div>
        <h2 style={{ margin: 0 }}>הפרויקט {secondary.displayName} עדיין לא זמין במסך העובדים</h2>
        <p style={{ margin: 0, opacity: 0.75 }}>בשלב זה הפרויקט זמין רק במודול התקלות למנהלים. התנתק ובחר פרויקט אחר במסך הכניסה.</p>
        <button type="button" onClick={onLogout} style={{ alignSelf: 'center', padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600 }}>התנתקות</button>
      </div>
    </div>
  );
};

export default App;

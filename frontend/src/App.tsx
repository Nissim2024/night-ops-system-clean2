import { useEffect, useState } from 'react';
import { Login } from './components/Login';
import { ManagerDashboard } from './components/ManagerDashboard';
import { EmployeeDashboard } from './components/EmployeeDashboard';
import { PermissionsProvider } from './context/PermissionsContext';
import { DialogProvider } from './context/DialogContext';
import { ErrorBoundary } from './components/ErrorBoundary';

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
        <PermissionsProvider token={token} role={payload.role}>
          {isManager
            ? <ManagerDashboard token={token} onLogout={handleLogout} deepLink={deepLink} onDeepLinkConsumed={() => setDeepLink(null)} />
            : <EmployeeDashboard token={token} onLogout={handleLogout} />
          }
        </PermissionsProvider>
      </DialogProvider>
    </ErrorBoundary>
  );
}

export default App;

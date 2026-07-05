import { useEffect, useState } from 'react';
import { Login } from './components/Login';
import { ManagerDashboard } from './components/ManagerDashboard';
import { EmployeeDashboard } from './components/EmployeeDashboard';
import { PermissionsProvider } from './context/PermissionsContext';
import { DialogProvider } from './context/DialogContext';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  const [token, setToken] = useState<string | null>(
    localStorage.getItem('deploycenter_token')
  );

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
            ? <ManagerDashboard token={token} onLogout={handleLogout} />
            : <EmployeeDashboard token={token} onLogout={handleLogout} />
          }
        </PermissionsProvider>
      </DialogProvider>
    </ErrorBoundary>
  );
}

export default App;

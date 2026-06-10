import { useState } from 'react';
import { Login } from './components/Login';
import { ManagerDashboard } from './components/ManagerDashboard';
import { EmployeeDashboard } from './components/EmployeeDashboard';
import { PermissionsProvider } from './context/PermissionsContext';

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

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  const payload = JSON.parse(atob(token.split('.')[1]));
  // VIEWER → ManagerDashboard (read-only via permissions), EMPLOYEE → EmployeeDashboard
  const isManager = ['ADMIN', 'RELEASE_MANAGER', 'CR_MANAGER', 'TEAM_LEAD', 'VIEWER'].includes(payload.role);

  return (
    <PermissionsProvider token={token} role={payload.role}>
      {isManager
        ? <ManagerDashboard token={token} onLogout={handleLogout} />
        : <EmployeeDashboard token={token} onLogout={handleLogout} />
      }
    </PermissionsProvider>
  );
}

export default App;

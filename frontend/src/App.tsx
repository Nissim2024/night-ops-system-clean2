import React, { useState } from 'react';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';

function App() {
  const [token, setToken] = useState<string | null>(
    localStorage.getItem('nightops_token')
  );

  const handleLogin = (newToken: string) => {
    localStorage.setItem('nightops_token', newToken);
    setToken(newToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('nightops_token');
    setToken(null);
  };

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  return <Dashboard token={token} onLogout={handleLogout} />;
}

export default App;
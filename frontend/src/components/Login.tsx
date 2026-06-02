import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DeployCenterLogo } from './DeployCenterLogo';
import { C, FONT } from '../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props {
  onLogin: (token: string) => void;
}

export const Login: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState('nissim@test.com');
  const [password, setPassword] = useState('123456');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [ldapEnabled, setLdapEnabled] = useState(false);

  useEffect(() => {
    axios.get(`${API}/auth/config`)
      .then(res => setLdapEnabled(!!res.data.ldapEnabled))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API}/auth/login`, { email: username, password });
      if (res.data.user?.fullName) {
        localStorage.setItem('deploycenter_fullName', res.data.user.fullName);
      }
      onLogin(res.data.token);
    } catch {
      setError(ldapEnabled ? 'שם משתמש או סיסמה שגויים' : 'אימייל או סיסמה שגויים');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    background: C.bgNested,
    border: `1px solid ${C.border}`,
    borderRadius: '8px',
    fontSize: '15px',
    color: C.textPrimary,
    fontFamily: FONT,
    boxSizing: 'border-box',
    outline: 'none',
    direction: 'ltr',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bgApp,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: FONT,
    }}>
      {/* Subtle background grid */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(45,125,210,0.08) 1px, transparent 0)',
        backgroundSize: '32px 32px',
      }} />

      <div style={{
        position: 'relative',
        background: C.bgCard,
        borderRadius: '16px',
        padding: '48px',
        width: '400px',
        border: `1px solid ${C.border}`,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <DeployCenterLogo variant="login" />
          <div style={{ marginTop: '12px', fontSize: '13px', color: C.textMuted }}>
            מערכת ניהול ליל ההטמעה
          </div>
        </div>

        {ldapEnabled && (
          <div style={{
            background: 'rgba(45,125,210,0.12)',
            border: `1px solid ${C.brand}`,
            borderRadius: '8px',
            padding: '10px 14px',
            marginBottom: '20px',
            fontSize: '13px',
            color: C.brand,
            textAlign: 'right',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span style={{ fontSize: '15px' }}>🔒</span>
            <span>כניסה דרך Active Directory</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block', marginBottom: '8px',
              color: C.textSecondary, fontWeight: '500', fontSize: '14px',
              textAlign: 'right',
            }}>
              {ldapEnabled ? 'שם משתמש (AD)' : 'אימייל'}
            </label>
            <input
              type={ldapEnabled ? 'text' : 'email'}
              value={username}
              onChange={e => setUsername(e.target.value)}
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = C.brand; }}
              onBlur={e => { e.target.style.borderColor = C.border; }}
            />
          </div>

          <div style={{ marginBottom: '28px' }}>
            <label style={{
              display: 'block', marginBottom: '8px',
              color: C.textSecondary, fontWeight: '500', fontSize: '14px',
              textAlign: 'right',
            }}>
              סיסמה
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = C.brand; }}
              onBlur={e => { e.target.style.borderColor = C.border; }}
            />
          </div>

          {error && (
            <div style={{
              background: C.bgFailed,
              border: `1px solid ${C.statusFailed}`,
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
              color: C.statusFailed,
              textAlign: 'center',
              fontSize: '14px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              background: loading ? C.bgHover : C.brand,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: FONT,
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'מתחבר...' : 'התחברות'}
          </button>
        </form>
      </div>
    </div>
  );
};

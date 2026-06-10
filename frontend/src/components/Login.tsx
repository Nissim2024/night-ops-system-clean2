import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DeployCenterLogo } from './DeployCenterLogo';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../theme';
import { Button, TextField, Alert, Spinner } from './ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;
const IS_TEST = process.env.REACT_APP_ENV === 'test';

interface Props {
  onLogin: (token: string) => void;
}

export const Login: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState(IS_TEST ? 'nissim@test.com' : '');
  const [password, setPassword] = useState(IS_TEST ? '123456' : '');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [ldapEnabled, setLdapEnabled] = useState(false);
  const [mounted, setMounted]   = useState(false);

  useEffect(() => {
    setMounted(true);
    axios.get(`${API}/auth/config`).then(r => setLdapEnabled(!!r.data.ldapEnabled)).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API}/auth/login`, { email: username, password });
      if (res.data.user?.fullName) localStorage.setItem('deploycenter_fullName', res.data.user.fullName);
      onLogin(res.data.token);
    } catch {
      setError(ldapEnabled ? 'שם משתמש Active Directory או סיסמה שגויים' : 'אימייל או סיסמה שגויים');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bgApp,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: FONT,
      direction: 'rtl',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Animated background */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: `
          radial-gradient(ellipse 80% 50% at 20% 40%, rgba(56,139,253,0.06) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 80% 60%, rgba(56,139,253,0.04) 0%, transparent 60%),
          radial-gradient(circle at 1px 1px, rgba(56,139,253,0.05) 1px, transparent 0)
        `,
        backgroundSize: 'auto, auto, 36px 36px',
      }} />

      {/* Glowing orb */}
      <div style={{
        position: 'fixed', top: '-120px', left: '50%', transform: 'translateX(-50%)',
        width: '600px', height: '400px', pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, rgba(56,139,253,0.08) 0%, transparent 70%)',
        filter: 'blur(40px)',
      }} />

      {/* Test env indicator */}
      {IS_TEST && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          background: 'linear-gradient(135deg, rgba(227,179,65,0.15), rgba(227,179,65,0.08))',
          borderBottom: `1px solid rgba(227,179,65,0.25)`,
          padding: '8px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SP[2],
          ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.warning, letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          <span>⚡</span> סביבת בדיקות (Test Environment)
        </div>
      )}

      {/* Login card */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: `linear-gradient(160deg, ${C.bgCard} 0%, rgba(13,17,23,0.95) 100%)`,
        borderRadius: RADIUS['2xl'],
        padding: '48px',
        width: '420px',
        border: `1px solid ${C.borderEm}`,
        boxShadow: SHADOW.floating,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(20px)',
        transition: 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        {/* Logo & branding */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <DeployCenterLogo variant="login" />
          <div style={{ marginTop: SP[3], ...TEXT.sm, color: C.textMuted, letterSpacing: '0.02em' }}>
            מערכת ניהול ליל ההטמעה
          </div>
          <div style={{
            width: '40px', height: '2px', margin: `${SP[3]} auto 0`,
            background: `linear-gradient(90deg, transparent, ${C.brand}, transparent)`,
            borderRadius: RADIUS.full,
          }} />
        </div>

        {/* AD badge */}
        {ldapEnabled && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: SP[2],
            background: C.brandDim, border: `1px solid rgba(56,139,253,0.30)`,
            borderRadius: RADIUS.lg, padding: `${SP[2]} ${SP[3]}`,
            marginBottom: SP[5],
            ...TEXT.sm, color: C.textLink,
          }}>
            <span>🔒</span>
            <span style={{ fontWeight: WEIGHT.medium }}>כניסה דרך Active Directory</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: SP[4] }}>
          <TextField
            label={ldapEnabled ? 'שם משתמש (AD)' : 'אימייל'}
            type={ldapEnabled ? 'text' : 'email'}
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder={ldapEnabled ? 'username' : 'user@example.com'}
            fullWidth
            autoComplete="username"
            dir="ltr"
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            }
            inputStyle={{ textAlign: 'left', paddingRight: '36px' }}
          />

          <TextField
            label="סיסמה"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            fullWidth
            autoComplete="current-password"
            dir="ltr"
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            }
            inputStyle={{ textAlign: 'left', paddingRight: '36px' }}
          />

          {error && (
            <Alert variant="danger" icon="🔑">
              {error}
            </Alert>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            style={{
              fontFamily: FONT,
              ...TEXT.md, fontWeight: WEIGHT.semibold,
              padding: '13px',
              background: loading || !username || !password
                ? C.bgHover
                : `linear-gradient(135deg, ${C.brand} 0%, #2563eb 100%)`,
              color: loading || !username || !password ? C.textMuted : 'white',
              border: `1px solid ${loading || !username || !password ? C.borderEm : 'transparent'}`,
              borderRadius: RADIUS.lg,
              cursor: loading || !username || !password ? 'not-allowed' : 'pointer',
              transition: EASE.standard,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SP[2],
              boxShadow: !loading && username && password ? `0 4px 14px rgba(56,139,253,0.35)` : undefined,
              marginTop: SP[1],
            }}
          >
            {loading ? (
              <><Spinner size={16} color="currentColor" /> מתחבר...</>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
                התחברות למערכת
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div style={{
          marginTop: SP[6], paddingTop: SP[4], borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: SP[2],
          ...TEXT.xs, color: C.textDisabled,
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: C.success, display: 'inline-block' }} />
          NightOps v2 · מאובטח
        </div>
      </div>
    </div>
  );
};

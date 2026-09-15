import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DeployCenterLogo } from './DeployCenterLogo';
import { C } from '../theme';
import { TextField, Alert, Spinner } from './ui';
import { cn } from '../lib/utils';
import pkg from '../../package.json';
const APP_VERSION: string = pkg.version;

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

  const isSubmitDisabled = loading || !username || !password;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background [direction:rtl]">
      {/* Animated background */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: `
          radial-gradient(ellipse 80% 50% at 20% 40%, rgba(56,139,253,0.06) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 80% 60%, rgba(56,139,253,0.04) 0%, transparent 60%),
          radial-gradient(circle at 1px 1px, rgba(56,139,253,0.05) 1px, transparent 0)
        `,
          backgroundSize: 'auto, auto, 36px 36px',
        }}
      />

      {/* Glowing orb */}
      <div
        className="pointer-events-none fixed top-[-120px] left-1/2 h-[400px] w-[600px] -translate-x-1/2"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(56,139,253,0.08) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* Test env indicator */}
      {IS_TEST && (
        <div
          className="fixed inset-x-0 top-0 flex items-center justify-center gap-2 px-5 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-warning"
          style={{
            background: 'linear-gradient(135deg, rgba(227,179,65,0.15), rgba(227,179,65,0.08))',
            borderBottom: '1px solid rgba(227,179,65,0.25)',
          }}
        >
          <span>⚡</span> סביבת בדיקות (Test Environment)
        </div>
      )}

      {/* Login card */}
      <div
        className={cn(
          'relative z-10 w-[420px] rounded-2xl border border-border p-12 shadow-xl transition-[opacity,transform] duration-slow ease-spring',
          mounted ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
        )}
        style={{ background: `linear-gradient(160deg, ${C.bgCard} 0%, rgba(13,17,23,0.95) 100%)` }}
      >
        {/* Logo & branding */}
        <div className="mb-9 text-center">
          <DeployCenterLogo variant="login" />
          <div className="mt-3 text-sm tracking-[0.02em] text-subtle-foreground">
            מערכת ניהול ליל ההטמעה
          </div>
          <div
            className="mx-auto mt-3 h-0.5 w-10 rounded-full"
            style={{ background: `linear-gradient(90deg, transparent, ${C.brand}, transparent)` }}
          />
        </div>

        {/* AD badge */}
        {ldapEnabled && (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary-50 px-3 py-2 text-sm text-info">
            <span>🔒</span>
            <span className="font-medium">כניסה דרך Active Directory</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
            disabled={isSubmitDisabled}
            className={cn(
              'mt-1 flex items-center justify-center gap-2 rounded-lg p-[13px] text-md font-semibold transition-[background,color,box-shadow,border-color] duration-base ease-out',
              isSubmitDisabled
                ? 'cursor-not-allowed border border-border bg-muted text-subtle-foreground'
                : 'cursor-pointer border border-transparent text-white shadow-[0_4px_14px_rgba(56,139,253,0.35)]'
            )}
            style={!isSubmitDisabled ? { background: `linear-gradient(135deg, ${C.brand} 0%, #2563eb 100%)` } : undefined}
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
        <div className="mt-6 flex items-center justify-center gap-2 border-t border-border pt-4 text-xs text-subtle-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
          DeployCenter v{APP_VERSION} · מאובטח
        </div>
      </div>
    </div>
  );
};

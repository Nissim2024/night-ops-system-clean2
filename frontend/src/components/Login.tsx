import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DeployCenterLogo } from './DeployCenterLogo';
import { C, FONT, RADIUS, SHADOW } from '../theme';
import { TextField, Alert, Spinner } from './ui';
import { cn } from '../lib/utils';
import pkg from '../../package.json';
const APP_VERSION: string = pkg.version;

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;
const IS_TEST = process.env.REACT_APP_ENV === 'test';

interface Props {
  onLogin: (token: string) => void;
}

// Real modules, same names/icons the sidebar itself uses (Sidebar.tsx) — not
// invented marketing copy, just a short reflection of what the app actually
// does, for the brand panel below.
const MODULE_HIGHLIGHTS = [
  { icon: '🧭', label: 'ניהול גרסה' },
  { icon: '🧠', label: 'ניהול בדיקות' },
  { icon: '🏆', label: 'איכות גרסה' },
];

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
    <div className="flex min-h-screen flex-col bg-background [direction:rtl]" style={{ fontFamily: FONT }}>
      {/* Test env indicator */}
      {IS_TEST && (
        <div
          className="flex shrink-0 items-center justify-center gap-2 px-5 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-warning"
          style={{
            background: 'linear-gradient(135deg, rgba(227,179,65,0.15), rgba(227,179,65,0.08))',
            borderBottom: `1px solid rgba(227,179,65,0.25)`,
          }}
        >
          <span>⚡</span> סביבת בדיקות (Test Environment)
        </div>
      )}

      {/* Two-panel layout — brand panel first (renders on the right under
          dir="rtl", matching where the app's own dark sidebar always sits),
          form panel second. Stacks vertically on narrow screens. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* ── Brand panel (dark, C.sidebarBg — same surface the app's real
            sidebar uses everywhere else, so this reads as "the same product"
            instead of a one-off gradient card) ── */}
        <div
          className="relative flex flex-col items-center justify-center gap-8 overflow-hidden px-10 py-14 md:w-[42%] md:py-0"
          style={{ background: C.sidebarBg }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `
                radial-gradient(ellipse 70% 50% at 30% 20%, rgba(110,168,255,0.14) 0%, transparent 60%),
                radial-gradient(ellipse 60% 45% at 75% 80%, rgba(110,168,255,0.08) 0%, transparent 60%),
                radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)
              `,
              backgroundSize: 'auto, auto, 32px 32px',
            }}
          />

          <div
            className={cn(
              'relative z-10 transition-[opacity,transform] duration-slow ease-spring',
              mounted ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
            )}
          >
            <DeployCenterLogo variant="login" dark />
          </div>

          <div
            className={cn(
              'relative z-10 flex flex-wrap items-center justify-center gap-2.5 transition-[opacity,transform] delay-100 duration-slow ease-spring',
              mounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
            )}
          >
            {MODULE_HIGHLIGHTS.map(m => (
              <span
                key={m.label}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: C.sidebarText }}
              >
                <span>{m.icon}</span>{m.label}
              </span>
            ))}
          </div>
        </div>

        {/* ── Form panel (light, C.bgApp — matches every other screen) ── */}
        <div className="flex flex-1 items-center justify-center p-6 md:p-12">
          <div
            className={cn(
              'w-full max-w-[380px] transition-[opacity,transform] duration-slow ease-spring',
              mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
            )}
          >
            <div className="mb-7">
              <h2 className="text-2xl font-bold" style={{ color: C.textPrimary }}>התחברות למערכת</h2>
              <p className="mt-1.5 text-sm" style={{ color: C.textMuted }}>הזן את הפרטים שלך כדי להמשיך</p>
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
                  'mt-1 flex items-center justify-center gap-2 p-[13px] text-md font-semibold transition-[background,color,box-shadow,border-color] duration-base ease-out',
                  isSubmitDisabled
                    ? 'cursor-not-allowed border border-border bg-muted text-subtle-foreground'
                    : 'cursor-pointer border-none text-white hover:brightness-110'
                )}
                style={{
                  borderRadius: RADIUS.md,
                  ...(!isSubmitDisabled ? { background: C.brand, boxShadow: SHADOW.sm } : {}),
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
            <div className="mt-6 flex items-center justify-center gap-2 border-t border-border pt-4 text-xs text-subtle-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
              DeployCenter v{APP_VERSION} · מאובטח
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

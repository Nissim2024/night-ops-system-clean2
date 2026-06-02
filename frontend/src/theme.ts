// NightOps Design System — Dark Theme
// All components import from here; never hardcode hex values.

export const C = {
  // ── Surfaces ──────────────────────────────────────────────────────────────
  bgApp:      '#0d1117',
  bgCard:     '#161b22',
  bgNested:   '#21262d',
  bgHover:    '#30363d',
  border:     '#30363d',
  borderEm:   '#484f58',

  // ── Brand ─────────────────────────────────────────────────────────────────
  brand:      '#2d7dd2',
  brandDim:   '#1c4f8a',

  // ── Text ──────────────────────────────────────────────────────────────────
  textPrimary:   '#e6edf3',
  textSecondary: '#c9d1d9',
  textMuted:     '#8b949e',
  textDisabled:  '#484f58',

  // ── Status — tuned for dark backgrounds ───────────────────────────────────
  statusOpen:       '#58a6ff',
  statusInProgress: '#d29922',
  statusBlocked:    '#f85149',
  statusFailed:     '#da3633',
  statusDone:       '#3fb950',
  statusWaiting:    '#a371f7',
  statusRollback:   '#8b949e',

  // ── Status chip backgrounds ────────────────────────────────────────────────
  bgOpen:       'rgba(88,166,255,0.15)',
  bgInProgress: 'rgba(210,153,34,0.15)',
  bgBlocked:    'rgba(248,81,73,0.18)',
  bgFailed:     'rgba(218,54,51,0.18)',
  bgDone:       'rgba(63,185,80,0.15)',
  bgWaiting:    'rgba(163,113,247,0.15)',
  bgRollback:   'rgba(139,148,158,0.12)',

  // ── GO / NO GO ────────────────────────────────────────────────────────────
  goBg:     '#0d2818',
  goBorder: '#3fb950',
  goText:   '#3fb950',
  nogoBg:   '#2d0f0f',
  nogoBorder:'#f85149',
  nogoText:  '#f85149',

  // ── Header ────────────────────────────────────────────────────────────────
  headerBg: 'linear-gradient(135deg, #0d1f35 0%, #1c3a5e 100%)',

  // ── Team palette (6 slots) ────────────────────────────────────────────────
  teams: ['#58a6ff','#3fb950','#a371f7','#d29922','#f78166','#39c5cf'],
} as const;

export const FONT = "'IBM Plex Sans Hebrew', 'Segoe UI', Arial, sans-serif";
export const FONT_MONO = "'IBM Plex Mono', 'Courier New', monospace";

// Status → color/bg lookup
export const statusColor = (s: string): string =>
  ({ OPEN: C.statusOpen, IN_PROGRESS: C.statusInProgress, BLOCKED: C.statusBlocked,
     FAILED: C.statusFailed, DONE: C.statusDone, WAITING: C.statusWaiting,
     ROLLED_BACK: C.statusRollback }[s] ?? C.textMuted);

export const statusBg = (s: string): string =>
  ({ OPEN: C.bgOpen, IN_PROGRESS: C.bgInProgress, BLOCKED: C.bgBlocked,
     FAILED: C.bgFailed, DONE: C.bgDone, WAITING: C.bgWaiting,
     ROLLED_BACK: C.bgRollback }[s] ?? 'transparent');

export const statusLabel = (s: string): string =>
  ({ OPEN: 'פתוח', IN_PROGRESS: 'בביצוע', BLOCKED: 'חסום',
     FAILED: 'נכשל', DONE: 'הושלם', WAITING: 'ממתין', ROLLED_BACK: 'Rollback' }[s] ?? s);

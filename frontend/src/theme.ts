// NightOps Design System v3 — Asana-Inspired Light Theme
// Single source of truth. All components import from here; never hardcode values.

// ── Color Palette ─────────────────────────────────────────────────────────────

export const C = {
  // ── Main content surfaces (LIGHT) ─────────────────────────────────────────
  bgApp:        '#F5F5F5',   // page / outer shell
  bgCard:       '#FFFFFF',   // cards, panels
  bgElevated:   '#FFFFFF',   // elevated panels
  bgNested:     '#F9F9F9',   // table rows, input bg
  bgHover:      '#F3F4F6',   // row hover
  bgActive:     '#EAF0FB',   // active / selected row
  bgOverlay:    'rgba(0,0,0,0.45)',

  // ── Borders (light) ───────────────────────────────────────────────────────
  border:       '#E8E8E8',
  borderEm:     '#D4D4D4',
  borderFocus:  '#4573D2',   // Asana focus ring blue

  // ── Brand (Asana warm red-orange) ─────────────────────────────────────────
  brand:        '#F06A6A',   // Asana primary
  brandHover:   '#E05555',
  brandDim:     '#FEF2F2',
  brandGlow:    'rgba(240,106,106,0.18)',

  // ── Sidebar (DARK — Asana-style) ──────────────────────────────────────────
  sidebarBg:        '#1E1F21',
  sidebarBgHover:   '#2C2D30',
  sidebarBgActive:  '#3B3D40',
  sidebarBorder:    '#3B3D40',
  sidebarText:      '#EFEFEF',
  sidebarTextMuted: '#838589',
  sidebarAccent:    '#F06A6A',

  // ── Header ────────────────────────────────────────────────────────────────
  headerBg:     '#FFFFFF',
  headerBorder: '#E8E8E8',

  // ── Text (dark — for light backgrounds) ──────────────────────────────────
  textPrimary:   '#1E1F21',
  textSecondary: '#4D4D4D',
  textMuted:     '#7F7F7F',
  textDisabled:  '#BDBDBD',
  textLink:      '#4573D2',
  textInverse:   '#FFFFFF',

  // ── Task status — color ───────────────────────────────────────────────────
  statusOpen:       '#4573D2',   // blue
  statusInProgress: '#E8AF00',   // amber
  statusBlocked:    '#F06A6A',   // red-orange
  statusFailed:     '#D32F2F',   // dark red
  statusDone:       '#37C47A',   // green
  statusWaiting:    '#9C6ADE',   // purple
  statusRollback:   '#9E9E9E',   // gray
  statusSkipped:    '#42B0C5',

  // ── Status chip backgrounds ───────────────────────────────────────────────
  bgOpen:       'rgba(69,115,210,0.10)',
  bgInProgress: 'rgba(232,175,0,0.12)',
  bgBlocked:    'rgba(240,106,106,0.12)',
  bgFailed:     'rgba(211,47,47,0.10)',
  bgDone:       'rgba(55,196,122,0.12)',
  bgWaiting:    'rgba(156,106,222,0.10)',
  bgRollback:   'rgba(158,158,158,0.08)',

  // ── Semantic ──────────────────────────────────────────────────────────────
  success:     '#37C47A',
  successBg:   'rgba(55,196,122,0.10)',
  warning:     '#E8AF00',
  warningBg:   'rgba(232,175,0,0.10)',
  danger:      '#F06A6A',
  dangerBg:    'rgba(240,106,106,0.10)',
  info:        '#4573D2',
  infoBg:      'rgba(69,115,210,0.10)',

  // ── Priority (Asana-style) ────────────────────────────────────────────────
  priorityHigh:   '#CD1A1A',
  priorityMedium: '#E8AF00',
  priorityLow:    '#4573D2',
  priorityBgHigh:   'rgba(205,26,26,0.10)',
  priorityBgMedium: 'rgba(232,175,0,0.10)',
  priorityBgLow:    'rgba(69,115,210,0.10)',

  // ── GO / NO-GO ────────────────────────────────────────────────────────────
  goBg:      '#ECFDF5',
  goBorder:  '#37C47A',
  goText:    '#0A7A47',
  nogoBg:    '#FFF2F2',
  nogoBorder:'#F06A6A',
  nogoText:  '#C0392B',

  // ── Team palette ─────────────────────────────────────────────────────────
  teams: ['#4573D2','#37C47A','#9C6ADE','#E8AF00','#F06A6A','#42B0C5','#F0883E','#6366F1'],
} as const;

// ── Typography ────────────────────────────────────────────────────────────────

export const FONT      = "'Segoe UI', -apple-system, 'IBM Plex Sans Hebrew', Arial, sans-serif";
export const FONT_MONO = "'SF Mono', 'Fira Code', 'Consolas', monospace";

export const TEXT = {
  xs:   { fontSize: '11px', lineHeight: '16px' },
  sm:   { fontSize: '12px', lineHeight: '18px' },
  base: { fontSize: '13px', lineHeight: '20px' },
  md:   { fontSize: '14px', lineHeight: '22px' },
  lg:   { fontSize: '15px', lineHeight: '24px' },
  xl:   { fontSize: '17px', lineHeight: '26px' },
  '2xl':{ fontSize: '20px', lineHeight: '28px' },
  '3xl':{ fontSize: '24px', lineHeight: '32px' },
  '4xl':{ fontSize: '30px', lineHeight: '38px' },
} as const;

export const WEIGHT = {
  normal:   '400',
  medium:   '500',
  semibold: '600',
  bold:     '700',
} as const;

// ── Spacing ───────────────────────────────────────────────────────────────────
export const SP = {
  1:  '4px',  2:  '8px',   3:  '12px', 4:  '16px',
  5:  '20px', 6:  '24px',  8:  '32px', 10: '40px',
  12: '48px', 16: '64px',  20: '80px',
} as const;

// ── Border Radius ─────────────────────────────────────────────────────────────
export const RADIUS = {
  xs: '3px', sm: '4px', md: '6px', lg: '8px',
  xl: '10px', '2xl': '12px', '3xl': '16px', full: '9999px',
} as const;

// ── Shadows (light theme) ─────────────────────────────────────────────────────
export const SHADOW = {
  xs:      '0 1px 2px rgba(0,0,0,0.06)',
  sm:      '0 1px 4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)',
  md:      '0 4px 12px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)',
  lg:      '0 8px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)',
  xl:      '0 16px 40px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.05)',
  floating:'0 24px 64px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)',
  brand:   '0 0 0 3px rgba(240,106,106,0.25)',
  glow:    '0 0 16px rgba(240,106,106,0.20)',
  inset:   'inset 0 1px 2px rgba(0,0,0,0.06)',
  card:    '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
} as const;

// ── Transitions ───────────────────────────────────────────────────────────────
export const EASE = {
  fast:     'all 0.12s cubic-bezier(0.4,0,0.2,1)',
  standard: 'all 0.20s cubic-bezier(0.4,0,0.2,1)',
  slow:     'all 0.35s cubic-bezier(0.4,0,0.2,1)',
  spring:   'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',
} as const;

// ── Status helpers ────────────────────────────────────────────────────────────
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

// ── Version status ────────────────────────────────────────────────────────────
export const versionStatusColor: Record<string, string> = {
  DRAFT:         C.textMuted,
  CR_REVIEW:     '#9C6ADE',
  COLLECTING:    '#4573D2',
  REFINING:      '#E8AF00',
  REVIEW:        '#42B0C5',
  APPROVED:      '#37C47A',
  REHEARSAL:     '#F0883E',
  ACTIVE:        '#F06A6A',
  MORNING_AFTER: '#9C6ADE',
  COMPLETED:     '#0A7A47',
  ROLLED_BACK:   C.textMuted,
};

export const versionStatusBg: Record<string, string> = {
  DRAFT:         'rgba(158,158,158,0.10)',
  CR_REVIEW:     'rgba(156,106,222,0.10)',
  COLLECTING:    'rgba(69,115,210,0.10)',
  REFINING:      'rgba(232,175,0,0.10)',
  REVIEW:        'rgba(66,176,197,0.10)',
  APPROVED:      'rgba(55,196,122,0.10)',
  REHEARSAL:     'rgba(240,136,62,0.10)',
  ACTIVE:        'rgba(240,106,106,0.12)',
  MORNING_AFTER: 'rgba(156,106,222,0.10)',
  COMPLETED:     'rgba(10,122,71,0.10)',
  ROLLED_BACK:   'rgba(158,158,158,0.08)',
};

export const versionStatusLabel: Record<string, string> = {
  DRAFT:         'טיוטה',
  CR_REVIEW:     'סקירת CR',
  COLLECTING:    'איסוף משימות',
  REFINING:      'טיוב תלויות',
  REVIEW:        'ישיבת מעבר',
  APPROVED:      'תוכנית מאושרת',
  REHEARSAL:     'חזרה גנרלית',
  ACTIVE:        'פעיל',
  MORNING_AFTER: 'בוקר לאחר גרסה',
  COMPLETED:     'הושלם',
  ROLLED_BACK:   'Rollback',
};

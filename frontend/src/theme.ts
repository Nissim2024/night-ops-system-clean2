// DeployCenter Design System v3 — Asana-Inspired Light Theme
// Single source of truth. All components import from here; never hardcode values.

// ── Color Palette ─────────────────────────────────────────────────────────────

// v4 — "Indigo" foundations, adapted 2026-07-17 from a Claude-Design handoff
// (design_handoff_deploycenter/styles.css). Only the foundation tokens
// (surfaces/borders/brand/sidebar/text/semantic + radii/shadows/fonts) were
// swapped — domain-specific palettes (task status, priority, severity,
// version status, team colors) are intentionally left on the previous
// values since the handoff didn't specify replacements for them, and
// changing those risks clashing with the new brand hue. Experimental branch
// (redesign-indigo-experiment) — revert to v3 values above if this doesn't
// look right in practice.
export const C = {
  // ── Main content surfaces (LIGHT) ─────────────────────────────────────────
  bgApp:        '#F7F8FB',   // page / outer shell
  bgCard:       '#FFFFFF',   // cards, panels
  bgElevated:   '#FFFFFF',   // elevated panels
  bgNested:     '#F1F2F7',   // table rows, input bg
  bgHover:      '#ECEDF5',   // row hover
  bgActive:     '#E6E7F5',   // active / selected row
  bgOverlay:    'rgba(20,21,42,0.45)',

  // ── Borders (light) ───────────────────────────────────────────────────────
  border:       '#E5E7EE',
  borderEm:     '#D3D6E0',
  borderFocus:  'oklch(0.55 0.19 265)',

  // ── Brand (indigo) ──────────────────────────────────────────────────────
  brand:        'oklch(0.55 0.19 265)',
  brandHover:   'oklch(0.48 0.19 265)',
  brandDim:     'oklch(0.94 0.03 265)',
  brandGlow:    'oklch(0.55 0.19 265 / 0.18)',

  // ── Sidebar (deep indigo-black — always dark regardless of app theme) ────
  sidebarBg:        '#14152A',
  sidebarBgHover:   '#1F2140',
  sidebarBgActive:  '#2A2C52',
  sidebarBorder:    '#2A2C52',
  sidebarText:      '#EDEDF7',
  sidebarTextMuted: '#8B8EA8',
  sidebarAccent:    'oklch(0.55 0.19 265)',

  // ── Header ────────────────────────────────────────────────────────────────
  headerBg:     '#FFFFFF',
  headerBorder: '#E5E7EE',

  // ── Text (dark — for light backgrounds) ──────────────────────────────────
  textPrimary:   '#14152A',
  textSecondary: '#585B70',
  textMuted:     '#9497AC',
  textDisabled:  '#C3C5D3',
  textLink:      '#0891B2',
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
  success:     '#16A34A',
  successBg:   '#EAFBF0',
  warning:     '#D97706',
  warningBg:   '#FEF6E7',
  danger:      '#DC2626',
  dangerBg:    '#FDECEC',
  info:        '#0891B2',
  infoBg:      '#E8F7FA',

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

  // ── Readable text-on-tint (for reason/alert boxes — statusBlocked/brand are too light for text) ──
  textOnBlockedBg: '#C0392B',

  // ── Block severity ────────────────────────────────────────────────────────
  severityLow:      '#4573D2',
  severityMedium:   '#E8AF00',
  severityHigh:     '#F0883E',
  severityCritical: '#C0392B',
  severityLowBg:      'rgba(69,115,210,0.10)',
  severityMediumBg:   'rgba(232,175,0,0.10)',
  severityHighBg:     'rgba(240,136,62,0.10)',
  severityCriticalBg: 'rgba(192,57,43,0.10)',

  // ── Team palette ─────────────────────────────────────────────────────────
  teams: ['#4573D2','#37C47A','#9C6ADE','#E8AF00','#F06A6A','#42B0C5','#F0883E','#6366F1'],

  // ── Module accents (from the indigo design handoff) — one fixed hue per
  // module, same oklch chroma/lightness family. Additive: not wired into any
  // existing component yet except ModuleFlowStrip's own literal colors.
  moduleRelease:     'oklch(0.55 0.19 265)', // Release Management — indigo
  moduleTestPlan:    'oklch(0.55 0.19 300)', // Test Planning — violet
  moduleMilestones:  'oklch(0.65 0.15 75)',  // Milestones — amber
  moduleTracking:    'oklch(0.58 0.13 195)', // Test Tracking — teal
  moduleDefects:     'oklch(0.55 0.20 20)',  // Defects — rose
  moduleGoLive:      'oklch(0.60 0.17 45)',  // Go-Live — orange
  moduleAnalytics:   'oklch(0.55 0.17 250)', // Analytics — blue
  moduleAccess:      'oklch(0.45 0.02 260)', // Access/SSO — muted slate
} as const;

// ── Typography ────────────────────────────────────────────────────────────────

export const FONT      = "'Rubik', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
export const FONT_MONO = "'Fira Code', 'SF Mono', Consolas, monospace";

// Bumped up significantly (2026-07-04), then bumped again by 20%+ (2026-07-14)
// per direct user request — legibility for users with weaker eyesight takes
// priority over information density.
export const TEXT = {
  xs:   { fontSize: '16px', lineHeight: '23px' },
  sm:   { fontSize: '17px', lineHeight: '24px' },
  base: { fontSize: '18px', lineHeight: '27px' },
  md:   { fontSize: '20px', lineHeight: '29px' },
  lg:   { fontSize: '22px', lineHeight: '32px' },
  xl:   { fontSize: '24px', lineHeight: '35px' },
  '2xl':{ fontSize: '28px', lineHeight: '38px' },
  '3xl':{ fontSize: '34px', lineHeight: '44px' },
  '4xl':{ fontSize: '42px', lineHeight: '52px' },
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
  xs: '4px', sm: '6px', md: '8px', lg: '12px',
  xl: '16px', '2xl': '16px', '3xl': '20px', full: '9999px',
} as const;

// ── Shadows (light theme) ─────────────────────────────────────────────────────
export const SHADOW = {
  xs:      '0 1px 2px rgba(20,21,42,.05)',
  sm:      '0 2px 8px rgba(20,21,42,.08)',
  md:      '0 6px 20px rgba(20,21,42,.10)',
  lg:      '0 10px 32px rgba(20,21,42,.12)',
  xl:      '0 20px 48px rgba(20,21,42,.14)',
  floating:'0 28px 72px rgba(20,21,42,.18)',
  brand:   '0 0 0 3px rgba(79,70,229,0.25)',
  glow:    '0 0 16px rgba(79,70,229,0.20)',
  inset:   'inset 0 1px 2px rgba(20,21,42,.06)',
  card:    '0 1px 3px rgba(20,21,42,.08), 0 1px 2px rgba(20,21,42,.04)',
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

// ── Block severity helpers ────────────────────────────────────────────────────
export const severityColor = (s?: string | null): string =>
  ({ LOW: C.severityLow, MEDIUM: C.severityMedium, HIGH: C.severityHigh, CRITICAL: C.severityCritical }[s ?? ''] ?? C.textMuted);

export const severityBg = (s?: string | null): string =>
  ({ LOW: C.severityLowBg, MEDIUM: C.severityMediumBg, HIGH: C.severityHighBg, CRITICAL: C.severityCriticalBg }[s ?? ''] ?? 'transparent');

export const severityLabel = (s?: string | null): string =>
  ({ LOW: 'נמוכה', MEDIUM: 'בינונית', HIGH: 'גבוהה', CRITICAL: 'קריטית' }[s ?? ''] ?? '—');

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

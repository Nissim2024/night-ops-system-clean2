// ── Single source of truth for the new (Linear-inspired) design system ─────
//
// This is a plain CommonJS file (not .ts) for one reason only: tailwind.config.js
// runs under plain Node, which cannot `require()` TypeScript without extra
// tooling (ts-node/jiti) that CRA's postcss pipeline doesn't have wired in.
// So the *raw values* live here, and:
//   - tailwind.config.js requires this file directly for `theme.extend`
//   - src/styles/tokens.ts imports this same file and re-exports everything
//     as typed, named constants for use in plain TS/TSX (non-Tailwind) code
//
// Do not hand-edit tokens.ts's values independently of this file — they will
// drift. Change values here; both consumers update together.
//
// Continuity note: many values below are intentionally identical to the
// existing src/theme.ts (the v3/v4 "Asana/Indigo" system) — bgApp, card,
// border, text, and the success/warning/danger/info hexes are copied 1:1,
// and neutral-900 reuses theme.ts's sidebarBg/textPrimary (#14152A). This is
// deliberate: the plan is eventual full migration off theme.ts, so the new
// palette anchors to the same brand hue and the same light-mode surfaces
// instead of introducing a second, competing color language.

/** Indigo brand scale, anchored on Linear's own #5E6AD2 at 500. */
const primary = {
  50: '#F5F6FE',
  100: '#ECEEFC',
  200: '#D8DBFA',
  300: '#B4B8F3',
  400: '#8B8FE8',
  500: '#5E6AD2',
  600: '#4C56C4',
  700: '#3E46A0',
  800: '#323875',
  900: '#282C57',
};

/** Cool neutral scale. 900 matches theme.ts sidebarBg/textPrimary (#14152A) for continuity. */
const neutral = {
  50: '#FAFAFB',
  100: '#F4F5F7',
  200: '#EBECEF',
  300: '#DCDEE4',
  400: '#B4B7C2',
  500: '#8A8F9C',
  600: '#6B7080',
  700: '#4E5262',
  800: '#33364E',
  900: '#14152A',
  950: '#0D0E1C',
};

/** Copied 1:1 from theme.ts so future migration doesn't shift any hue. */
const semantic = {
  success: '#16A34A',
  successBg: '#EAFBF0',
  warning: '#D97706',
  warningBg: '#FEF6E7',
  danger: '#DC2626',
  dangerBg: '#FDECEC',
  info: '#0891B2',
  infoBg: '#E8F7FA',
};

/**
 * Light theme surfaces — copied 1:1 from theme.ts (bgApp/bgCard/bgNested/
 * border/textPrimary/textSecondary/textMuted) so existing and new screens
 * read as the same app during the migration period.
 */
const light = {
  background: '#F7F8FB',
  card: '#FFFFFF',
  popover: '#FFFFFF',
  muted: '#F1F2F7',
  border: '#E5E7EE',
  input: '#E5E7EE',
  ring: primary[500],
  foreground: '#14152A',
  mutedForeground: '#585B70',
  subtleForeground: '#9497AC',
};

/**
 * Dark theme surfaces — not copied from theme.ts (no real dark mode exists
 * there yet), but not invented from nothing either: these reuse theme.ts's
 * sidebar palette (the one proven "dark surface" already shipping in this
 * app) so a future toggle feels like a natural extension, not a new look.
 */
const dark = {
  background: '#14152A',
  card: '#1B1C36',
  popover: '#1F2140',
  muted: '#1F2140',
  border: '#2A2C52',
  input: '#2A2C52',
  ring: primary[400],
  foreground: '#EDEDF7',
  mutedForeground: '#8B8EA8',
  subtleForeground: '#6D7093',
};

/**
 * Font sizes are intentionally NOT Linear's actual (compact, ~13px) scale.
 * theme.ts bumped sizes ~20%+ specifically for legibility per a direct user
 * request (see theme.ts TEXT comment) — this scale preserves those exact
 * px/line-height pairs under standard Tailwind-style key names so nothing
 * regresses when a screen migrates over.
 */
const fontSize = {
  xs: ['16px', '23px'],
  sm: ['17px', '24px'],
  base: ['18px', '27px'],
  md: ['20px', '29px'],
  lg: ['22px', '32px'],
  xl: ['24px', '35px'],
  '2xl': ['28px', '38px'],
  '3xl': ['34px', '44px'],
  '4xl': ['42px', '52px'],
};

const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

/** Latin text renders in Inter; Inter has no Hebrew glyphs so it falls back to Rubik automatically. */
const fontFamily = {
  sans: ['Inter', 'Rubik', 'system-ui', '-apple-system', 'Segoe UI', 'Arial', 'sans-serif'],
  mono: ['Fira Code', 'SF Mono', 'Consolas', 'monospace'],
};

/** 4px-multiple scale; 1–20 match theme.ts SP exactly, finer steps added for component internals. */
const spacing = {
  0.5: '2px',
  1: '4px',
  1.5: '6px',
  2: '8px',
  2.5: '10px',
  3: '12px',
  3.5: '14px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
};

/** xs/sm/md/lg match theme.ts RADIUS; xl/2xl/3xl fixed into a real progression (theme.ts had xl==2xl, a bug). */
const borderRadius = {
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
  '3xl': '24px',
  full: '9999px',
};

const boxShadow = {
  light: {
    xs: '0 1px 2px rgba(20,21,42,.05)',
    sm: '0 2px 8px rgba(20,21,42,.08)',
    md: '0 6px 20px rgba(20,21,42,.10)',
    lg: '0 10px 32px rgba(20,21,42,.12)',
    xl: '0 20px 48px rgba(20,21,42,.14)',
    focus: `0 0 0 3px ${primary[500]}40`,
  },
  dark: {
    xs: '0 1px 2px rgba(0,0,0,.30)',
    sm: '0 2px 8px rgba(0,0,0,.35)',
    md: '0 6px 20px rgba(0,0,0,.40)',
    lg: '0 10px 32px rgba(0,0,0,.45)',
    xl: '0 20px 48px rgba(0,0,0,.50)',
    focus: `0 0 0 3px ${primary[400]}40`,
  },
};

/** 150–200ms ease-out, as requested; `spring` is only for entrance micro-interactions (dialogs/dropdowns). */
const transitionDuration = {
  fast: '150ms',
  base: '200ms',
  slow: '350ms',
};

const transitionTimingFunction = {
  out: 'cubic-bezier(0.4, 0, 0.2, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

module.exports = {
  primary,
  neutral,
  semantic,
  light,
  dark,
  fontSize,
  fontWeight,
  fontFamily,
  spacing,
  borderRadius,
  boxShadow,
  transitionDuration,
  transitionTimingFunction,
};

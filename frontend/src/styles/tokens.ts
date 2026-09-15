// Typed, app-facing entry point to the new (Linear-inspired) design system.
//
// The actual values live in ./palette.js (a plain JS/CJS file) because
// tailwind.config.js — which must consume the identical values — runs under
// plain Node and can't require() TypeScript without extra build tooling this
// project doesn't have wired in. This file just re-exports those same values
// with real types, so app code gets full autocomplete/type-safety.
//
// This is meant to eventually replace src/theme.ts. Until that migration
// happens, both files coexist: theme.ts backs the ~80 existing inline-style
// screens, tokens.ts backs anything built with src/components/ui/*.
/* eslint-disable @typescript-eslint/no-var-requires */
const palette = require('./palette') as {
  primary: Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;
  neutral: Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>;
  semantic: { success: string; successBg: string; warning: string; warningBg: string; danger: string; dangerBg: string; info: string; infoBg: string };
  light: Record<'background' | 'card' | 'popover' | 'muted' | 'border' | 'input' | 'ring' | 'foreground' | 'mutedForeground' | 'subtleForeground', string>;
  dark: Record<'background' | 'card' | 'popover' | 'muted' | 'border' | 'input' | 'ring' | 'foreground' | 'mutedForeground' | 'subtleForeground', string>;
  fontSize: Record<'xs' | 'sm' | 'base' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl', [string, string]>;
  fontWeight: Record<'normal' | 'medium' | 'semibold' | 'bold', string>;
  fontFamily: { sans: string[]; mono: string[] };
  spacing: Record<string, string>;
  borderRadius: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full', string>;
  boxShadow: { light: Record<string, string>; dark: Record<string, string> };
  transitionDuration: Record<'fast' | 'base' | 'slow', string>;
  transitionTimingFunction: Record<'out' | 'spring', string>;
};

export const PRIMARY = palette.primary;
export const NEUTRAL = palette.neutral;
export const SEMANTIC = palette.semantic;
export const LIGHT = palette.light;
export const DARK = palette.dark;
export const FONT_SIZE = palette.fontSize;
export const FONT_WEIGHT = palette.fontWeight;
export const FONT_FAMILY = palette.fontFamily;
export const SPACING = palette.spacing;
export const RADIUS = palette.borderRadius;
export const SHADOW = palette.boxShadow;
export const DURATION = palette.transitionDuration;
export const EASING = palette.transitionTimingFunction;

/** CSS font-family strings, ready to drop into an inline `style` prop. */
export const FONT_SANS = FONT_FAMILY.sans.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', ');
export const FONT_MONO = FONT_FAMILY.mono.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', ');

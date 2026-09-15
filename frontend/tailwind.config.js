// New Linear-inspired UI kit only. Deliberately NOT touching the existing
// 80+ inline-style screens (see src/theme.ts) in this pass — see
// src/styles/palette.js for the full rationale and the source-of-truth note.
const palette = require('./src/styles/palette');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Class strategy so dark mode can be wired later without a second build path.
  // Nothing in the app adds the `dark` class yet — this only prepares the code.
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: {
    // Tailwind's reset touches h1-h6/button/input/etc globally — with 80+
    // existing screens still on inline styles, that reset would visibly
    // break them. Disabled until (if) a full migration removes theme.ts.
    preflight: false,
  },
  theme: {
    extend: {
      // NOTE: these four MUST stay under `extend`, not top-level `theme`.
      // Top-level replaces Tailwind's entire default scale outright — that
      // silently deleted spacing['0'] once already (broke `inset-0`, `p-0`,
      // etc. app-wide) because our custom scale doesn't define a '0' key.
      // `extend` merges ours on top of the full default scale instead.
      fontFamily: {
        sans: palette.fontFamily.sans,
        mono: palette.fontFamily.mono,
      },
      fontSize: palette.fontSize,
      fontWeight: palette.fontWeight,
      spacing: palette.spacing,
      borderRadius: palette.borderRadius,
      colors: {
        primary: {
          ...palette.primary,
          DEFAULT: palette.primary[500],
          foreground: '#FFFFFF',
        },
        neutral: palette.neutral,
        success: { DEFAULT: 'hsl(var(--success) / <alpha-value>)', bg: 'hsl(var(--success-bg) / <alpha-value>)' },
        warning: { DEFAULT: 'hsl(var(--warning) / <alpha-value>)', bg: 'hsl(var(--warning-bg) / <alpha-value>)' },
        danger: { DEFAULT: 'hsl(var(--danger) / <alpha-value>)', bg: 'hsl(var(--danger-bg) / <alpha-value>)' },
        info: { DEFAULT: 'hsl(var(--info) / <alpha-value>)', bg: 'hsl(var(--info-bg) / <alpha-value>)' },

        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: 'hsl(var(--card) / <alpha-value>)',
        popover: 'hsl(var(--popover) / <alpha-value>)',
        muted: 'hsl(var(--muted) / <alpha-value>)',
        'muted-foreground': 'hsl(var(--muted-foreground) / <alpha-value>)',
        'subtle-foreground': 'hsl(var(--subtle-foreground) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        focus: 'var(--shadow-focus)',
      },
      transitionDuration: palette.transitionDuration,
      transitionTimingFunction: palette.transitionTimingFunction,
      letterSpacing: {
        tight: '-0.02em',
        snug: '-0.01em',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'slide-down': { from: { opacity: '0', transform: 'translateY(-4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms cubic-bezier(0.4,0,0.2,1)',
        'fade-out': 'fade-out 150ms cubic-bezier(0.4,0,0.2,1)',
        'scale-in': 'scale-in 150ms cubic-bezier(0.4,0,0.2,1)',
        'slide-down': 'slide-down 200ms cubic-bezier(0.4,0,0.2,1)',
        'slide-up': 'slide-up 200ms cubic-bezier(0.4,0,0.2,1)',
      },
    },
  },
  plugins: [],
};

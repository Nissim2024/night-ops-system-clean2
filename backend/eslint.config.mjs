// @ts-check
// Backend lint (restored 2026-10-10 — ESLint 9 found no config, so `npm run
// lint` failed outright). Bug-finding rules only: no formatting / prettier
// (the lint script runs with --fix and must not rewrite the codebase's style),
// and the rules this codebase deliberately doesn't follow (`any`, unused
// args kept for signatures, require() of optional native modules) are off.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'prisma/**', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.jest }, sourceType: 'commonjs' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      'no-case-declarations': 'warn',
      'no-control-regex': 'off',
    },
  },
);

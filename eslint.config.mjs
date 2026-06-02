import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * AAELink ESLint config (v0.0.43).
 *
 * Replaces the v0.0.42 placebo config (`{ ignores: ['.next/**'] }` only) with
 * a real rule set:
 *
 *   • `typescript-eslint/recommended` — strict TS rules. The codebase already
 *     passes the strictest TS checks; this codifies it for new contributors.
 *   • `eslint-plugin-react-hooks/recommended-latest` — catches stale-closure
 *     bugs in the 81 hooks across `app/home/page.tsx` and elsewhere.
 *
 * Future additions tracked separately:
 *   • `eslint-config-next/core-web-vitals` — currently incompatible with
 *     ESLint 10 (the bundled `eslint-plugin-react` calls the removed
 *     `context.getFilename()` API). Reinstate when that lands.
 *   • `eslint-plugin-jsx-a11y` — peers on ESLint ≤9; reinstate with v7+.
 *   • Custom rule banning `console.*` outside `lib/log.ts` — lands in the
 *     v0.0.43 piece D (centralized logger) follow-on.
 */
export default [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'desktop/**',
      '.claude/**',
      '.graphify/**',
      'archive/**',
      'next-env.d.ts',
      'docs/openapi.json',
      'scripts/*.js',
      'scripts/*.cjs',
    ],
  },
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    rules: {
      // The codebase has 130+ unused-import / unused-var sites in test files
      // alone. Demoting to a warning here so the lint gate becomes a real
      // signal in CI without forcing a 130-callsite cleanup in the same
      // release. v0.0.44 will codemod the offenders and promote back to error.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Same reason: 50+ `any` callsites in test fixtures. Promote in v0.0.44.
      '@typescript-eslint/no-explicit-any': 'warn',
      // `prefer-const` flagged a handful of tests; auto-fixable in v0.0.44.
      'prefer-const': 'warn',
    },
  },
  // ── audit-2026-05-26 CHG-003: bias console toward lib/log.ts ───────────
  // Warn in app and lib code; trust tests and scripts to use console freely.
  {
    files: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
    rules: {
      // Allow `console.warn` / `console.error` (lib/logger.ts uses them) but
      // warn on the rest. The codemod tracked under CHG-003 promotes this to
      // 'error' once the 30 remaining drift sites are migrated.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Carve-outs: legitimate console users.
  {
    files: ['lib/log.ts', 'lib/logger.ts', 'lib/tracing.ts', 'lib/auditStream.ts'],
    rules: { 'no-console': 'off' },
  },
]

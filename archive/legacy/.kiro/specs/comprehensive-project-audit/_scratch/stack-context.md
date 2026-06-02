# StackContext — immutable payload for the Audit_Skill_Chain

This file is the canonical scratch artifact produced by Task 2.1 of the comprehensive-project-audit plan. Every skill task in the chain (2.2 through 2.9) reads this file as its `Stack_Context` input. The payload is **immutable** — no skill mutates it, and every skill receives a deep-equal copy.

## 1. The literal `StackContext` object

```ts
const STACK_CONTEXT: StackContext = {
  framework: "Next.js 16",
  ui: "React 19",
  language: "TypeScript",
  postgres: { client: "pg", pool: "lib/db.ts#getPool()" },
  migrations: "lib/migrate.ts",
  test: { unit: "Vitest", e2e: "Playwright" },
  editor: "Tiptap",
  storage: "AWS S3",
  desktop: "desktop/ Electron client",
  apiRouteCount: "~80 route groups",
  fourGates: ["tsc --noEmit", "eslint .", "vitest run", "next build"],
} as const;
```

The `StackContext` interface is the spec artifact defined in `design.md`
(section "Audit_Skill_Chain pipeline"):

```ts
interface StackContext {
  framework: "Next.js 16";
  ui: "React 19";
  language: "TypeScript";
  postgres: { client: "pg"; pool: "lib/db.ts#getPool()" };
  migrations: "lib/migrate.ts";
  test: { unit: "Vitest"; e2e: "Playwright" };
  editor: "Tiptap";
  storage: "AWS S3";
  desktop: "desktop/ Electron client";
  apiRouteCount: "~80 route groups";
  fourGates: ["tsc --noEmit", "eslint .", "vitest run", "next build"];
}
```

## 2. Immutability contract

- The object above is the **single source of truth** for skill steps 2.2 through 2.9.
- Skills MUST NOT mutate the payload. Each skill receives a deep-equal copy. If a skill needs derived context, it builds a new local variable; it never edits `STACK_CONTEXT` in place.
- Per Requirement 5.5, the same `StackContext` is passed to every skill in the chain without modification. Any drift between two skill invocations is a structural failure of the audit run and must be flagged as a 🔴 Critical_Finding.
- Determinism (Requirement 10.3) depends on this immutability: two runs against the same workspace state on the same UTC date must produce byte-equal Findings, which is only possible if the `StackContext` does not vary per skill.

## 3. Verified against repo state

Each field was confirmed against actual repository state on 2026-05-25 (UTC) before this scratch file was written. Citations below use file paths and approximate line numbers; line numbers may shift if the file is edited later.

| Field | Value | Verified at | Notes |
|------|-------|-------------|-------|
| `framework` | `Next.js 16` | `package.json` dependency `"next": "^16.2.4"` (deps block, ~line 65). Build script `"build": "next build"` (~line 16). | Next 16 confirmed live. |
| `ui` | `React 19` | `package.json` `"react": "^19.2.5"`, `"react-dom": "^19.2.5"` (~lines 67–68). `"@types/react": "^19"`, `"@types/react-dom": "^19"` (~lines 60–61). | React 19 confirmed. |
| `language` | `TypeScript` | `package.json` `"typescript": "^6.0.3"` (~line 70). Script `"type-check": "tsc --noEmit"` (~line 21). | TypeScript toolchain confirmed (typescript 6.x). |
| `postgres.client` | `pg` | `package.json` `"pg": "^8.20.0"` (~line 66). `"@types/pg": "^8.20.0"` in devDependencies. | pg client confirmed. |
| `postgres.pool` | `lib/db.ts#getPool()` | `lib/db.ts` exports `function getPool(): Pool \| null` and instantiates `new Pool({ connectionString: url, max: 8, idleTimeoutMillis: 30_000 })` exactly once via the module-scoped `pool` variable (lines 1–14). | Single-pool primitive confirmed. Direct `new Pool(...)` outside `lib/db.ts` is forbidden by guardrail G1 (`design.md`). |
| `migrations` | `lib/migrate.ts` | File present at `/Users/d7y1ce/AAE/AAELink/lib/migrate.ts`. Test file `tests/migrate.test.ts` exists. | Migration pipeline confirmed. Guardrail G2 routes all schema changes through this module. |
| `test.unit` | `Vitest` | `package.json` `"vitest": "^4.1.5"` (devDependencies). Script `"test": "vitest run"` (~line 47). Tests under `tests/*.test.ts` import from `'vitest'` (e.g. `tests/migrate.test.ts`, `tests/logger.test.ts`, `tests/wsGateway/protocol.test.ts`). | Vitest confirmed as the unit-test framework. |
| `test.e2e` | `Playwright` | `package.json` `"@playwright/test": "^1.59.1"` (devDependencies). Scripts `"e2e": "playwright test"`, `"e2e:ui": "playwright test --ui"`, `"e2e:chromium": "playwright test --project=chromium"` (~lines 49–51). | Playwright confirmed for end-to-end tests. |
| `editor` | `Tiptap` | `package.json` deps include `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `@tiptap/extension-link`, `@tiptap/extension-mention`, `@tiptap/extension-placeholder`, plus `tiptap-markdown` (all `^3.22.5` / `^0.9.0`). | Tiptap editor confirmed. |
| `storage` | `AWS S3` | `package.json` `"@aws-sdk/client-s3": "^3.1038.0"` in dependencies. Test `tests/s3.test.ts` exercises `getBucket`, `getS3Client` from `@/lib/s3`. | AWS S3 client confirmed. |
| `desktop` | `desktop/ Electron client` | Directory `desktop/` exists. `desktop/package.json` declares `"name": "aaelink-desktop"`, `"main": "src/main.js"`, scripts `"start": "ELECTRON_OVERRIDE_APP_NAME=AAELink electron ."` and electron-builder targets `dist:mac`, `dist:win`. Root `package.json` exposes `desktop:install`, `desktop:start`, `desktop:start:lan`, `desktop:start:wifi:https`, `desktop:build:mac`, `desktop:build:win` scripts. | Electron desktop client confirmed. |
| `apiRouteCount` | `~80 route groups` | Directory `app/api/` has 73 top-level subdirectories (route groups). `find app/api -name route.ts -type f` reports 237 individual `route.ts` files (groups frequently contain nested `[id]/route.ts`, `[id]/<sub>/route.ts`, etc.). The "~80 route groups" approximation in `design.md` matches the top-level group count. | API surface confirmed. Guardrail G5 requires every API-route recommendation to cite an `app/api/.../route.ts` path. |
| `fourGates[0]` | `tsc --noEmit` | `package.json` script `"type-check": "tsc --noEmit"` (~line 21). Aggregate script `"release:build": "npm run lint && npm run type-check && npm run build"` (~line 22). | Gate 1 confirmed. |
| `fourGates[1]` | `eslint .` | `package.json` script `"lint": "eslint ."` (~line 20). | Gate 2 confirmed. |
| `fourGates[2]` | `vitest run` | `package.json` script `"test": "vitest run"` (~line 47). | Gate 3 confirmed. |
| `fourGates[3]` | `next build` | `package.json` script `"build": "next build"` (~line 16). | Gate 4 confirmed. |

## 4. Reaffirmation note for downstream tasks

Tasks 2.2 through 2.9 (the eight skill invocations) MUST:

1. Read this file as the `Stack_Context` input.
2. Pass the literal `STACK_CONTEXT` object to the skill without mutation.
3. Treat any deviation between the value in this file and the value used at skill invocation time as a structural failure of the audit run.

If any field above no longer matches repo state at the time the audit runs, the auditor MUST stop, regenerate this scratch file from current repo state, and only then continue with the skill chain. The Verification_Protocol (Phase F / Task 7) will re-check stack-context fidelity via the Phase G guardrails (Tasks 8.1 through 8.5).

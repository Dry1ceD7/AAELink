---
name: superpowers-verification
description: The pre-completion verification checklist for AAELink. Activate before declaring any task done — runs the four gates and codifies the "shipped" message format.
---

# Verification Before Completion (AAELink-adapted)

> Source: `.claude/skills/superpowers/verification-before-completion/SKILL.md` (MIT, obra/superpowers v5.1.0).

## The four gates

Before you can declare a task done, every one of these must exit 0:

```bash
npm run type-check    # tsc --noEmit
npm run lint          # eslint .
npm test              # vitest run
npm run build         # next build
```

No exceptions. "Should be fine" is not evidence; the exit code is.

## When to run

- After a batch of related edits — not after every single edit.
- Before any "done" / "shipped" message.
- Before bumping `package.json` version or writing release notes.
- Before posting a sub-agent reply that says the work is complete.

## Pre-flight checklist

Before running the gates, confirm:

- [ ] All files referenced in the changes are saved (no in-flight edits)
- [ ] No `.kiro/.tmp` or scratch files committed
- [ ] All new tests live in `tests/` (Vitest convention) — not `__tests__/`
- [ ] Any new API route has `tracedRoute` + `verifyCsrf` + `readSessionUserId` + `writeAuditLog` per `.claude/CLAUDE.md`
- [ ] Schema changes went through `lib/migrate.ts` `ensureSchema()` (idempotent, back-compat with v1 deployments)
- [ ] Any `getPool()` use comes from `lib/db.ts` — never `new Pool()` outside that module

## Failure handling

- **Type check failure** — fix at the call site. Do not silence with `as unknown` or `// @ts-ignore` unless there is a comment explaining why.
- **Lint failure** — fix; don't `// eslint-disable` unless the rule is genuinely wrong for the case (and add a one-line comment explaining why).
- **Test failure** — find the regression. If the failing test is yours and the new behavior is intentional, update the test; if it isn't yours, you broke something.
- **Build failure** — usually a missing import or a route export shape mismatch. Read the build output before guessing.

## "Shipped" message format

Only valid after all four gates pass. The structure:

```
## v0.0.X-alpha shipped — <one-line summary>

<2-3 bullet description of what changed>

**Verification (all four gates green at v0.0.X-alpha):**
- `tsc --noEmit` → 0 errors
- `eslint .` → 0 issues
- `vitest run` → N / N green (deltas if any)
- `next build` → passes

**Files of note:** ...
```

Anything that ships without this verification block is not actually verified.

## Sub-agent verification

When `invoke_sub_agent` is used, the sub-agent's "completed" reply is **not** verification. The main agent must still run the four gates after the sub-agent returns. Trust the sub-agent's output, verify the build.

## Failure-mode reminders

- Don't run the gates one at a time and stop at the first green — run all four. Lint and build can both pass while tests are red.
- Don't run the gates from a directory that isn't the repo root.
- Don't claim "all green" if you haven't read the test count. The expected number is in `README.md`. If your run says fewer tests, something is being skipped.

For the full canonical text, read `.claude/skills/superpowers/verification-before-completion/SKILL.md`.

---
name: superpowers-tdd
description: Test-Driven Development discipline for AAELink. Activate before writing any production code. Pulls in the canonical RED-GREEN-REFACTOR rules adapted for this repo's Vitest + Next.js setup.
---

# Test-Driven Development (AAELink-adapted)

> Source: `.claude/skills/superpowers/test-driven-development/SKILL.md` (MIT, obra/superpowers v5.1.0). This skill is the project-local cut.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

If you wrote production code before a failing test for it, **delete the production code and start over.** Don't keep it as "reference". Don't "adapt" it while writing the test. Delete means delete.

## RED — Write the failing test

Tests live in `tests/` (note: the project uses `tests/` not `__tests__/`). Vitest, not Jest.

- One behavior per test
- Clear, descriptive name
- Real code over mocks where possible

**Run it and watch it fail:**

```bash
npm test -- <test-name>
```

The failure must be the *expected* failure (assertion mismatch), not a typo or import error. If the test errors instead of failing, fix it and rerun until it fails for the right reason.

## GREEN — Minimal code to pass

Write the simplest code that makes the test pass. **No extras.** No flags, no options, no "while I'm in here", no YAGNI violations.

```bash
npm test -- <test-name>
```

Test must pass. Other tests must still pass. Output pristine (no errors, no warnings).

## REFACTOR — Clean up

Only after green:
- Remove duplication
- Improve names
- Extract helpers

Tests stay green throughout. No new behavior.

## Bug fixes

Every bug fix starts with a regression test that fails before the fix. Watch it fail, write the fix, watch it pass. The test goes into `tests/`.

## What "exception" means

The canonical skill says exceptions are "throwaway prototypes, generated code, configuration files." For AAELink the only realistic exceptions are:

- One-line typo fixes
- Pure-prose changes (READMEs, release notes)
- CSS-only changes that don't change a component's API

Anything else needs the failing test first.

## Verification before declaring done

After RED-GREEN-REFACTOR for the change in hand, run **all four gates** before declaring done:

```bash
npm run type-check && npm run lint && npm test && npm run build
```

All four must exit 0. The "shipped" template in your reply is only valid after this.

## Common rationalizations to refuse

- "I'll write tests after to verify it works" → tests written after pass immediately, proving nothing.
- "I already manually tested all the edge cases" → manual is ad-hoc, no record, not repeatable.
- "Deleting X hours of work is wasteful" → sunk cost. Keeping unverified code is technical debt.
- "TDD is dogmatic, I'm being pragmatic" → TDD *is* pragmatic. Debugging in production is slower.
- "This is different because..." → no, it isn't.

## When stuck

| Problem | Move |
|---|---|
| Don't know how to test | Write the *wished-for* API first; let the test drive design. |
| Test setup is huge | Design is too coupled — simplify the interface. |
| Have to mock everything | Use dependency injection; you're testing the wrong layer. |

## Final rule

Production code → test exists and failed first. Otherwise it isn't TDD.

For the full canonical text (with worked examples), read `.claude/skills/superpowers/test-driven-development/SKILL.md`.

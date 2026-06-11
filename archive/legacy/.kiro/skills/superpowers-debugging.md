---
name: superpowers-debugging
description: Systematic root-cause debugging discipline. Activate when a bug is non-obvious, when an approach has failed twice, or when you catch yourself making incremental patches without a hypothesis.
---

# Systematic Debugging (AAELink-adapted)

> Source: `.claude/skills/superpowers/systematic-debugging/SKILL.md` (MIT, obra/superpowers v5.1.0).

## The four phases

1. **Reproduce** — turn the report into a failing test or a deterministic manual reproduction. If you can't reproduce, you don't have a bug; you have a theory.
2. **Hypothesize** — read the relevant code (don't grep-and-guess). Form a single, falsifiable hypothesis about the root cause. Write it down.
3. **Verify** — design the experiment that would confirm or refute the hypothesis. Run it. Either the bug is in the code path you suspected or it isn't.
4. **Fix** — only after the hypothesis is confirmed. The fix should be the smallest change that resolves the root cause; if the fix is bigger than the bug, you're refactoring, which is a separate workstream.

## Failure-loop recognition

If an approach has failed twice in a row (same error, slightly different patch each time), **stop**. The Kiro system prompt explicitly forbids incremental patching. Step back, re-read the code, re-form the hypothesis, try a fundamentally different approach.

If the new approach deviates from the user's original intent or drops a requested requirement, surface that explicitly and confirm before proceeding.

## What "verify the hypothesis" looks like

- For a flaky test: add temporary instrumentation (logs, timing) that proves whether the flake is timing, ordering, or external dependency.
- For an "occasionally wrong" computation: pin the inputs that cause the wrong output. Run with those inputs in isolation. The bug must reproduce there.
- For a "users see X" report: capture an exact reproduction (URL, click sequence, network conditions) before touching code.

## What goes in the test suite afterward

Every confirmed bug becomes a regression test. The test must fail on `main` before the fix and pass after. Without the test, the fix is brittle.

## Defense-in-depth

If a single bug is possible because a contract was implicit, also strengthen the contract:

- Add a TypeScript type that makes the bad state unrepresentable.
- Add an assertion at the boundary where the invariant must hold.
- Add an integration test that catches violations of the invariant from multiple call sites.

You don't have to do all three. Pick the smallest one that prevents recurrence.

## Anti-patterns

- "Let me just try this" — if you can't say what the change tests, you're guessing.
- "It works on my machine" — environment is part of the bug; capture it.
- "I think it's a race condition" — prove it. Add a deliberate delay or instrument the order of operations.
- Catch-all `try/catch` to "make the error go away" — the error is now invisible, not gone.

## Linking to TDD

Bug fixes are a TDD activity, not a separate flow. RED is the failing regression test. GREEN is the minimal fix. REFACTOR is optional cleanup. See `.kiro/skills/superpowers-tdd.md`.

For the full canonical text, read `.claude/skills/superpowers/systematic-debugging/SKILL.md`.

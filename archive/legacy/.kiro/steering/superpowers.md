---
inclusion: always
---

# Superpowers — methodology for this project

Adapted from [obra/superpowers](https://github.com/obra/superpowers) (MIT). The full skill set lives in `.claude/skills/superpowers/`. This steering file is the always-on summary; activate the deeper skills via the `discloseContext` tool when a task fits.

## Core philosophy

- **Test-Driven Development** — write the failing test first, watch it fail, write minimal code, watch it pass, then refactor. If you didn't watch the test fail, you don't know if it tests the right thing.
- **Systematic over ad-hoc** — process before guessing. Read the code, form a hypothesis, verify the hypothesis, then act.
- **Complexity reduction** — simplicity is the primary goal. YAGNI ("You Aren't Gonna Need It") and DRY ("Don't Repeat Yourself") apply.
- **Evidence over claims** — verify before declaring success. The four gates (`tsc --noEmit`, `eslint .`, `vitest run`, `next build`) must all pass before any "shipped" message.

## The phases

When a task is non-trivial (new feature, multi-file change, anything you can't picture finishing in one read of the code), follow this order:

1. **Brainstorming** — refine the rough idea through Socratic questions before writing any code. Show the design in chunks small enough to read. Get explicit sign-off before moving on. Use `discloseContext` with `superpowers-brainstorming` if the user wants to design with me.
2. **Writing plans** — break work into 2–5 minute tasks. Every task has exact file paths, complete code, and verification steps. Use `discloseContext` with `superpowers-plans` to load the planning skill.
3. **Test-driven implementation** — RED-GREEN-REFACTOR cycle. Existing-code refactors first add a test that captures the current behavior, then refactor.
4. **Code review** — between tasks, audit against the plan, report issues by severity. Use `discloseContext` with `superpowers-review`.
5. **Finishing a branch** — verify all four gates green, present merge/PR/keep/discard options, never auto-commit without explicit user permission.

## What this means in practice for AAELink

- For a one-line typo fix: skip phases 1, 2, 4. Just edit + verify.
- For a new feature touching ≥3 files or any new API route: do all five phases. Skipping the brainstorming phase produces incoherent work that the user will reject.
- For a bug fix: at minimum write a regression test that fails before the fix, watch it pass after. The test goes into `tests/` (not `__tests__/` — the project's existing convention).
- For a refactor: capture-then-refactor. Add a test that pins current behavior, refactor, rerun the test.
- Never declare a task done without all four gates green. The "shipped" template is only valid after `tsc --noEmit && eslint . && vitest run && next build` all pass with exit code 0.

## Skill manifest

The full skill files in `.claude/skills/superpowers/` are:

| Skill | When to activate |
|-------|------------------|
| `brainstorming` | The user has a rough idea; we need to refine it before writing code |
| `writing-plans` | A design exists; we need to turn it into a stepped implementation plan |
| `executing-plans` | A plan exists; we need to walk through it task-by-task with checkpoints |
| `subagent-driven-development` | A long autonomous run is appropriate; dispatch sub-agents per task |
| `dispatching-parallel-agents` | Multiple independent sub-tasks could run concurrently |
| `test-driven-development` | About to write any production code |
| `systematic-debugging` | A bug is non-obvious and needs root-cause analysis |
| `verification-before-completion` | About to declare a task done |
| `requesting-code-review` | A batch of related edits is finished; want a self-audit |
| `receiving-code-review` | Reviewer surfaced issues; need to triage and respond |
| `using-git-worktrees` | Multiple parallel branches needed (rare in this repo's flow) |
| `finishing-a-development-branch` | A feature branch is complete; need to merge/PR |
| `writing-skills` | Adding new skills to this catalogue |
| `using-superpowers` | Meta — how the skill system itself works |

## Invocation rules

- **Never assume a skill applies without reading it.** When the activation trigger fires (e.g. "about to write code" → TDD), use `discloseContext` to pull in the full skill text before acting.
- **Skills are mandatory, not suggestions.** If the TDD skill says "delete code written before tests", that means delete it.
- **The four gates apply regardless of skill flow.** Even when following Superpowers, no task is done until all four gates pass.
- **Match repo conventions over skill conventions.** Where the canonical Superpowers `writing-plans` skill suggests `git worktree`, AAELink's branch model uses regular branches; honor the project model.

## What I am explicitly not doing

- Not running an external watcher process (no `fswatch`, no agent-bridge background loop). Kiro is single-turn; the equivalent is the `postToolUse` hook that runs `npm run type-check && npm run lint && npm test && npm run build` after a batch of writes.
- Not spawning a different model as reviewer. The closest equivalent is `invoke_sub_agent` for fresh-context delegation when a task is broad enough to benefit from isolation.

# Story: <Title>

- **Status:** Draft | Ready | In progress | Review | Done | Cancelled
- **Created:** YYYY-MM-DD
- **Owner:** <agent name or human>
- **Parent plan:** <relative path to docs/feature-plans/... or PRD>
- **Roadmap milestone:** <semver from docs/ROADMAP.yaml>
- **Size:** S | M | L | XL
- **Related:** <ADR numbers, audit sections, parity matrix entries>

## User story

As a `<user role>`, I want to `<capability>` so that `<value>`.

## Context

One short paragraph: where this story comes from (PRD, audit finding, parity gap, bug report) and what its purpose is inside the parent plan. Cite the parent plan section.

## Scope

- **In scope:** bullet list of what this story covers.
- **Out of scope:** bullet list of what this story explicitly does not cover. Cite where the out-of-scope items live (later story, deferred to next milestone, won't-fix).

## Acceptance criteria

Numbered, testable, observable from outside the story. Each criterion must be something a test, a CLI command, or a user action can verify.

1. ...
2. ...
3. ...

## Definition of Done (story-level)

Check every box before flipping `Status: Done`. These extend the project-level DoD in `.claude/CLAUDE.md`, they do not replace it.

### Code

- [ ] All acceptance criteria pass their tests
- [ ] New API routes wrap with `tracedRoute()` (`aaelink-api-route` skill)
- [ ] New API routes call `readSessionUserId()` and the appropriate workspace / RBAC check
- [ ] Mutations call `assertCsrf(req)` and write an `auditLog({...})` row
- [ ] Schema changes go through `lib/migrate.ts` `ensureSchema` (or the v0.0.57+ versioned `migrationRunner`)
- [ ] No raw `import 'pg'` — `getPool()` only
- [ ] Realtime emits go through `lib/realtime.ts` / `lib/redisPubSub.ts`
- [ ] Booleans default `false`, arrays default `[]`, never `null` in API responses

### Tests

- [ ] New `lib/` modules have a `tests/<name>.test.ts` (TDD: failing test first, watched it fail)
- [ ] New API routes have an entry under `__tests__/api/`
- [ ] Bug-fix stories have a regression test that fails before the fix and passes after
- [ ] Realtime emit assertions where applicable
- [ ] Audit log assertions where applicable

### Verification gates

- [ ] `npm run type-check` passes (exit 0)
- [ ] `npm run lint` passes (exit 0)
- [ ] `npm test` passes (exit 0)
- [ ] `npm run build` passes (exit 0)

### Alignment

- [ ] `/aae-blueprint-align` reports no new blockers
- [ ] No new top-level dependencies without an ADR (`.claude/CLAUDE.md` rule 7)
- [ ] Roadmap milestone in this story matches an entry in `docs/ROADMAP.yaml`
- [ ] If this story closes a parity gap, the parity matrix is updated
- [ ] If this story changes user-facing behavior, README / docs are updated

### Accessibility (UI stories only)

- [ ] Keyboard reachable
- [ ] Visible focus ring
- [ ] ARIA labels present on icon-only controls
- [ ] `prefers-reduced-motion` honored on any new animation

## Implementation notes

Optional. Anything the developer agent needs to know that does not belong in acceptance criteria: file paths, library quirks, sequencing, cleanup steps.

## Test plan

Describe the test surface in one paragraph plus a list. The list maps every acceptance criterion to one or more test names.

| Acceptance criterion | Test file | Test name |
|----------------------|-----------|-----------|
| 1                    |           |           |
| 2                    |           |           |
| 3                    |           |           |

## Risks

Optional. Numbered list of things that could go wrong, each with a one-sentence mitigation.

1. ...
2. ...

## References

- ...

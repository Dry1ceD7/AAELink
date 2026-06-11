# AAELink Stories

This directory holds per-story working artifacts. Each story is one unit of work that fits inside a single `/aae-feature-plan` output and carries its own acceptance criteria and Definition of Done.

## Why per-story DoD

`.claude/CLAUDE.md` defines a project-level Definition of Done. That DoD covers the project but not individual units of work. At 227 routes and the v0.1.0 production-readiness scale, parallel work streams need per-story acceptance criteria so one agent can pick up where another left off without re-deriving intent.

Stories also let `/aae-blueprint-align` and `/aae-release-check` audit at finer granularity than the project-level DoD allows.

## Format

Each story is a markdown file at `.kiro/stories/<YYYY-MM-DD>-<slug>.md`.

Use `/aae-story-create` to scaffold a new one. The template lives at `.kiro/stories/STORY_TEMPLATE.md`.

## Lifecycle

1. **Draft** — story is being written; acceptance criteria not yet final.
2. **Ready** — acceptance criteria final; story is dispatchable to a developer agent.
3. **In progress** — a developer agent is working on it; tests are being written or implementation is underway.
4. **Review** — implementation is complete; awaiting code review (`/aae-blueprint-align` and friends).
5. **Done** — all acceptance criteria checked; all four gates green; merged.
6. **Cancelled** — story was abandoned (rare; record why in the story file).

Move stories along by editing the `Status:` line at the top. Do not delete cancelled or done stories — history is part of the contract.

## Relationship to BMAD

`/bmad-create-story` and `/bmad-create-epics-and-stories` produce stories in BMAD's own format, written to `_bmad-output/`. Stories created with `/aae-story-create` live here at `.kiro/stories/` because they are the AAELink dialect: they include AAELink-specific acceptance criteria (tracedRoute, audit log, realtime emit, four gates) that the generic BMAD template does not cover.

Reach for `/bmad-create-story` when the story belongs to a BMAD-driven workflow (PRD → architecture → epics → stories). Reach for `/aae-story-create` when the story comes from `/aae-feature-plan`.

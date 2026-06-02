# ADR-0001: Adopt BMAD Method as the AAELink agent workflow framework

- **Status:** Accepted
- **Date:** 2026-05-20
- **Deciders:** AAELink core team
- **Related:**
  - `.kiro/steering/bmad.md`
  - `.kiro/steering/superpowers.md`
  - `.claude/CLAUDE.md`
  - `docs/BLUEPRINT.md`
  - [BMAD-METHOD on GitHub](https://github.com/bmad-code-org/BMAD-METHOD)
  - [BMAD docs](https://docs.bmad-method.org/)

## Context

A fit analysis showed AAELink already runs roughly 80% of the BMAD Method (Breakthrough Method of Agile AI-driven Development) organically. The five-phase Superpowers flow (brainstorm → plan → TDD → review → finish), the four-gates verification hook, the `docs/BLUEPRINT.md` north star, the `tracedRoute` chokepoint, the `.claude/skills/aaelink-*` skill catalogue, and the `/aae-*` slash commands map almost one-to-one onto BMAD's Analyst / Architect / PM / Developer / QA agents and onto BMAD's Definition-of-Done discipline.

Four genuine gaps remained:

1. No formal per-story format. Project-level Definition of Done in `.claude/CLAUDE.md` covered the project but not individual units of work.
2. No machine-readable roadmap. `docs/ROADMAP.md` is narrative, so agents could not consult it programmatically during alignment checks.
3. No structured ADR register. Rule 7 in `.claude/CLAUDE.md` mandated ADR-style PR notes for new dependencies but had no queryable home for them.
4. No dedicated analyst skill. Requirement elicitation was being absorbed by the developer agent on large features, which BMAD identifies as an anti-pattern.

The cost of leaving these gaps grows with project size. At 227 routes and the v0.1.0-beta production-readiness milestone, parallel work streams need explicit handoff signals and per-unit acceptance criteria.

## Decision

Adopt BMAD Method as the formal name for AAELink's agent workflow framework, install the BMAD CLI as an escape hatch for workflows AAELink-specific skills do not yet cover, and fill the four gaps with project-native artifacts that compose with the existing Superpowers and Caveman steering.

Concretely:

1. Install BMAD v6.7.1 (BMM core) into `_bmad/` via `npx bmad-method install --modules bmm --tools claude-code --yes`. 44 BMAD skills land at `.claude/skills/bmad-*`.
2. Add `.kiro/steering/bmad.md` documenting the BMAD ↔ AAELink mapping and reach-for ordering (project-specific skill first, BMAD generic second).
3. Publish a machine-readable roadmap at `docs/ROADMAP.yaml`, kept in sync with the narrative `docs/ROADMAP.md`. `/aae-blueprint-align` reads it during the new roadmap-version alignment check.
4. Create `docs/ADR/` with `README.md`, `TEMPLATE.md`, and a `/aae-adr-create` slash command. This ADR is the first entry.
5. Add an `aaelink-analyst` skill that activates on any new feature request and produces a mini-PRD before `/aae-feature-plan` runs.
6. Add `.kiro/stories/` with `STORY_TEMPLATE.md`, a `README.md`, and a `/aae-story-create` slash command. Stories carry per-unit acceptance criteria and a story-scoped Definition of Done.
7. Append a `## Handoff` block (Triggers / Produces / Hands off to / Gate required) to every `aaelink-*` skill file so multi-agent work has explicit signal-passing.

## Alternatives considered

1. **Do nothing — keep the organic mix of Superpowers + AAELink skills + slash commands.** Rejected because the four gaps are real and grow with project scale. The fit analysis showed the developer agent was already absorbing analyst work on large features, and the absence of per-story DoD is a known coordination risk for the v0.1.0 parallel work streams.

2. **Replace Superpowers with vanilla BMAD.** Rejected because Superpowers' four-gates hook, TDD discipline, and five-phase flow are exact analogs of BMAD primitives that are already wired into Kiro's `postToolUse` event system. Rebuilding them as BMAD-flavored variants would lose the Kiro-native integration and discard tested practices. AAELink also has domain-specific extensions (compliance, parity, realtime, RBAC) that vanilla BMAD does not cover.

3. **Adopt BMAD informally — name what exists but install nothing.** Rejected because the BMAD CLI's generic agents (`bmad-help`, `bmad-quick-dev`, `bmad-party-mode`) and scaffolders (`bmad-create-prd`, `bmad-create-architecture`, `bmad-create-epics-and-stories`) are useful escape hatches when an AAELink-specific skill is under-scoped for the task at hand. The install cost is one command and ~44 skill files; the upside is a free generic toolkit alongside the project-specific one.

## Consequences

### Positive

- The four BMAD gaps are closed before v0.1.0 parallel work streams expose them.
- Agents reach for project-specific skills first and generic BMAD skills only when the project-specific ones are under-scoped — explicit ordering documented in `.kiro/steering/bmad.md`.
- ADRs are now queryable and indexed in `docs/ADR/README.md`, satisfying `.claude/CLAUDE.md` rule 7 with a real register instead of scattered PR notes.
- Stories carry per-unit DoD, which lets `/aae-blueprint-align` and `/aae-release-check` audit at a finer granularity than project-level.
- `docs/ROADMAP.yaml` makes alignment checks deterministic — agents stop guessing whether work belongs to the current milestone.
- The `aaelink-analyst` skill closes the developer-absorbing-analyst-work anti-pattern.

### Negative

- One more steering file (`bmad.md`) and one more directory tree (`_bmad/`) to keep current.
- The BMAD CLI brings its own update cadence; `_bmad/` may need periodic `npx bmad-method install` re-runs.
- `docs/ROADMAP.yaml` and `docs/ROADMAP.md` must be kept in sync. Drift between them is now a class of bug.
- Two scaffolding directories (`docs/ADR/` and `.kiro/stories/`) need maintenance and indexing discipline.

### Neutral

- Project-level Definition of Done in `.claude/CLAUDE.md` remains authoritative; story-level DoD is additive, not a replacement.
- Caveman chat-style rules and Superpowers TDD/four-gates rules are unchanged. BMAD adds structure on top, never overrides them.

## Implementation notes

Files written under this ADR:

- `_bmad/` (BMAD install, version 6.7.1, BMM core)
- `_bmad-output/planning-artifacts/`, `_bmad-output/implementation-artifacts/`
- `.kiro/steering/bmad.md`
- `.claude/skills/bmad-*/` (44 BMAD skills)
- `.claude/skills/aaelink-analyst/SKILL.md`
- `docs/ROADMAP.yaml`
- `docs/ADR/README.md`, `docs/ADR/TEMPLATE.md`, `docs/ADR/0001-bmad-method-adoption.md`
- `.kiro/stories/README.md`, `.kiro/stories/STORY_TEMPLATE.md`
- `.claude/commands/aae-adr-create.md`, `.claude/commands/aae-story-create.md`
- `## Handoff` block appended to nine `.claude/skills/aaelink-*/SKILL.md` files
- `.claude/commands/aae-blueprint-align.md` extended with a roadmap-version check

Follow-up work expected:

- When `.kiro/skills/aaelink-*` mirrors are next regenerated, the handoff blocks should be propagated.
- `/aae-release-check` should be extended at the next opportunity to read story DoD checkboxes the same way `/aae-blueprint-align` reads `docs/ROADMAP.yaml`.

## References

- BMAD-METHOD repository: https://github.com/bmad-code-org/BMAD-METHOD
- BMAD documentation: https://docs.bmad-method.org/
- AAELink fit analysis (chat session, 2026-05-20)
- `.claude/CLAUDE.md` rules 1–10
- `.kiro/steering/superpowers.md`
- `docs/BLUEPRINT.md`

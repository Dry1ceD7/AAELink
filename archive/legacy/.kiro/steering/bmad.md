# BMAD Method — AAELink dialect

AAELink already runs ~80% of the [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) (Breakthrough Method of Agile AI-driven Development). This steering file names what already exists, points at the four small gaps that have been filled, and tells agents which BMAD primitive to reach for in any given situation.

BMAD itself is installed at `_bmad/` (v6.7.1, BMM core). 44 BMAD skills are available under `.claude/skills/bmad-*` and can be invoked alongside the project-specific `aaelink-*` skills.

## BMAD ↔ AAELink mapping

| BMAD primitive | AAELink equivalent | Status |
|----------------|--------------------|--------|
| Analyst agent | `aaelink-analyst` skill (workspace) + `bmad-agent-analyst` (BMAD) | Present |
| Architect agent | `aaelink-blueprint` skill + `docs/BLUEPRINT.md` (canonical north star) + `bmad-agent-architect` | Present |
| Product Manager agent | `/aae-feature-plan` slash command + `bmad-agent-pm` | Present |
| Developer agent | `aaelink-api-route` / `aaelink-realtime` / `aaelink-ui-component` skills + `bmad-agent-dev` | Present |
| QA agent | `aaelink-testing` skill + `/aae-test-gap` + `/aae-parity-audit` + `/aae-security-audit` + `bmad-qa-generate-e2e-tests` | Present |
| Compliance agent | `aaelink-compliance` (extends BMAD; not a stock primitive) | AAELink extension |
| Security agent | `aaelink-rbac-audit` + `/aae-security-audit` (extends BMAD) | AAELink extension |
| Realtime agent | `aaelink-realtime` (extends BMAD) | AAELink extension |
| Parity agent | `aaelink-feature-parity` + `/aae-parity-audit` (extends BMAD) | AAELink extension |
| Orchestrator | `AGENTS.md` priority order + `caveman.md` + this file | Present |
| Definition of Done | `.claude/CLAUDE.md` DoD block | Present |
| Story / task gates | `.kiro/hooks/superpowers-four-gates.kiro.hook` (post-write) | Present |
| TDD mandate | `.kiro/steering/superpowers.md` | Present |
| Feature phases | brainstorm → plan → TDD → review → finish (Superpowers) | Present |
| Story format (per-unit DoD) | `.kiro/stories/` + `STORY_TEMPLATE.md` + `/aae-story-create` | Filled gap |
| ADR register | `docs/ADR/` + `/aae-adr-create` | Filled gap |
| Agent handoff protocol | `## Handoff` block at the bottom of every `aaelink-*` skill | Filled gap |
| Machine-readable roadmap | `docs/ROADMAP.yaml` (companion to narrative `docs/ROADMAP.md`) | Filled gap |

## When agents reach for which primitive

1. **New feature request lands.** Activate `aaelink-analyst` first. It runs structured requirement elicitation (user, problem, non-goals, compliance implications) and produces a mini-PRD in `_bmad-output/planning-artifacts/`. Only then does `/aae-feature-plan` run.
2. **Plan is ready.** Use `/aae-story-create` to break it into stories under `.kiro/stories/`. Each story carries acceptance criteria and a per-story DoD checklist.
3. **Architectural decision required** (new dep, new store, new transport). Run `/aae-adr-create` to record it under `docs/ADR/NNNN-*.md`. New deps without an ADR violate `.claude/CLAUDE.md` rule 7.
4. **Implementation phase.** Standard Superpowers TDD loop. Skill handoff blocks tell each agent what artifact it produces and which agent picks up next.
5. **Pre-merge.** `/aae-blueprint-align` runs blueprint + roadmap-version alignment checks (the roadmap-version check reads `docs/ROADMAP.yaml`).
6. **Pre-release.** `/aae-release-check` plus the four gates (`tsc --noEmit`, `eslint .`, `vitest run`, `next build`).

## BMAD CLI escape hatches

The full BMAD framework is installed and available when a workflow it covers is broader than what AAELink-specific skills handle:

- `/bmad-help` — context-aware guidance from BMAD itself.
- `/bmad-create-prd`, `/bmad-create-architecture`, `/bmad-create-epics-and-stories`, `/bmad-create-story` — BMAD's own scaffolders. Use them when a task is large enough that the AAELink slash commands feel under-scoped.
- `/bmad-quick-dev` — small features and bug fixes.
- `/bmad-party-mode` — multi-agent discussion mode for thorny cross-cutting decisions.
- `/bmad-retrospective`, `/bmad-sprint-planning`, `/bmad-sprint-status` — agile cadence.

Prefer the AAELink-specific skill or slash command when one exists. Reach for the BMAD generic when nothing project-specific covers the work.

## Coexistence rules

- **Superpowers methodology still authoritative** on TDD, four-gates, the five-phase flow.
- **Caveman rules still authoritative** on chat style; file contents (this file included) are written normal.
- **AAELink hard rules** (`.claude/CLAUDE.md`) still authoritative on tracedRoute, `getPool()`, `lib/migrate.ts`, audit, CSRF, realtime emit chokepoints.
- BMAD adds structure on top, never overrides any of the above.

## What this file is not

This is not a tutorial on BMAD. The full BMAD docs ship with the install at `_bmad/` and at https://docs.bmad-method.org/. This file exists so agents working on AAELink know which primitive to reach for without having to discover BMAD from scratch every session.

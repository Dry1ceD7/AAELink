# Architecture Decision Records (ADRs)

This directory holds queryable, versioned records of architectural decisions taken on AAELink. Each ADR captures one decision: the context that forced it, the alternatives considered, the choice made, and the consequences accepted.

ADRs exist because:

- `.claude/CLAUDE.md` rule 7 forbids new top-level dependencies without an ADR-style PR note. Without a register, those notes scatter into PR descriptions and stop being queryable.
- The Superpowers `using-git-worktrees`, `writing-plans`, and `writing-skills` flows all assume an architect artifact that survives outside any single PR.
- BMAD treats the architect's output as a first-class artifact. ADRs are the AAELink dialect of that artifact.

## Format

Each ADR is a markdown file at `docs/ADR/NNNN-short-slug.md` where `NNNN` is a zero-padded sequence number (e.g. `0001`, `0042`). Numbers do not get reused — superseded ADRs stay on disk with their status flipped to `Superseded by NNNN`.

Use `/aae-adr-create` to scaffold a new one. The template lives at `docs/ADR/TEMPLATE.md`.

## Statuses

- `Proposed` — draft, under discussion, not yet in effect
- `Accepted` — agreed and in effect
- `Superseded by NNNN` — replaced by a newer ADR (link to it)
- `Deprecated` — no longer in effect but not directly replaced

## Index

| Number | Title | Status | Date |
|--------|-------|--------|------|
| [0001](0001-bmad-method-adoption.md) | Adopt BMAD Method as the AAELink agent workflow framework | Accepted | 2026-05-20 |
| [0002](0002-ws-gateway-topic-on-subscribe.md) | Extend the WS gateway protocol with explicit `topic` on subscribe/unsubscribe | Accepted | 2026-05-20 |

When you accept a new ADR, append a row to this table.

## When to write an ADR

Write an ADR when the decision:

1. Adds, removes, or pins a top-level dependency (rule 7).
2. Picks one storage / transport / framework over another with long-term lock-in.
3. Establishes a project-wide pattern or chokepoint (e.g. `tracedRoute` was an ADR-grade decision before the chokepoint existed).
4. Changes an existing chokepoint or convention.
5. Trades off a security, compliance, or accessibility property to gain something else.

Trivial choices (which CSS variable name, which icon to ship) do not need an ADR.

## When not to write an ADR

If the decision is reversible inside a single PR with no follow-on cleanup, it is not ADR-grade. Comment in the PR instead.

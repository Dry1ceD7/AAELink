# ADR-0012: Role-hierarchy strings → OpenFGA (ReBAC) + ABAC overlays

- **Status:** Proposed
- **Date:** 2026-05-26
- **Deciders:** AAELink architecture team
- **Related:** `docs/BLUEPRINT.md` § 4.3, § 5.5; audit-2026-05-26 DRIFT-015; CHG-010; `docs/ROADMAP.yaml` post-ga.openfga-rebac

## Context

AAELink models authorization today via three string-keyed enums:
- platform role on `aaelink.users.platform_role` (`super_admin` / `it_admin` / `it_employee` / `employee`)
- workspace role on `aaelink.workspace_members.role`
- channel role on `aaelink.channel_members.role`

Helpers live in `lib/platformRole.ts` and `lib/workspaceAccess.ts`. This is sufficient for the alpha but cannot express:
- Cross-org / federation visibility rules (BLUEPRINT § 5.5)
- Information-barrier semantics (`aaelink.compliance/barriers/route.ts` enforces them at the route level today, not at the data layer)
- Department-scoped guest access (BLUEPRINT § 5.5 mentions ABAC overlays)

BLUEPRINT § 4.3 / § 5.5 name OpenFGA (ReBAC) plus ABAC overlays as the target authorization stack.

## Decision

Adopt OpenFGA as the authorization decision point at milestone M6. Application code moves from "is this user role X?" calls to `fga.check(user, action, resource)`. ABAC overlays sit on top for attribute-driven decisions (department, residency region, time-of-day).

## Alternatives considered

1. **Cedar (AWS) policy engine.** Comparable expressiveness; weaker first-party support outside AWS. Reject.
2. **OPA / Rego.** Battle-tested but verbose; ReBAC modeling is an exercise rather than a primitive. Reject for the relationship-graph use case (channels of channels of teams).
3. **Stay on string enums.** Cannot express the BLUEPRINT § 5.5 information-barrier and federation models. Reject.

## Consequences

### Positive
- ReBAC matches the data shape (channels in workspaces; messages in channels; threads in messages) without role explosions.
- Decouples policy from code; auditors can read the model.
- Centralizes the audit trail of authorization decisions.

### Negative
- New service to operate (OpenFGA).
- All callsites that currently take a role string need migration; touches every `app/api/**/route.ts` that calls `userIsItForWorkspace()` etc.

### Neutral
- The migration is gradual: introduce OpenFGA for federation / barriers first; extend to in-org permissions as a second phase.

## References

- `docs/BLUEPRINT.md` § 4.3 + § 5.5
- `docs/audit-2026-05-26.md` § Goal Drift Flags — DRIFT-015
- OpenFGA documentation: <https://openfga.dev/>

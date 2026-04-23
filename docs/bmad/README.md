# BMAD Method — AAELink

AAELink follows the **BMAD Method** (Business · Mechanics · Architecture · Delivery)
from [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
with workspace-level cognitive orchestration.

## Authoritative sources

| Layer | File | Status |
|---|---|---|
| Workspace charter | [`/Users/d7y1ce/AAE/AGENTS.md`](../../../AGENTS.md) | ✅ live |
| Workspace rule | `.cursor/rules/bmad-cognitive-orchestration.mdc` (root) | ✅ live |
| AAELink rule | [`AAELink/.cursor/rules/bmad-aaelinklink-orchestration.mdc`](../../.cursor/rules/bmad-aaelinklink-orchestration.mdc) | ✅ live |
| Local install | `AAELink/_bmad/` (cursor + claude-code) | ✅ v6.3.0 |

## Personas used in AAELink

| Persona | Skill | Domain |
|---|---|---|
| **John** — Product Manager | `bmad-agent-pm` | PRD, scope, priorities |
| **Winston** — Architect | `bmad-agent-architect` | System design, integration |
| **Amelia** — Developer | `bmad-agent-dev` | Implementation, story exec |
| **Mary** — Analyst | `bmad-agent-analyst` | Requirements, discovery |
| **Sally** — UX Designer | `bmad-agent-ux-designer` | Frontend, flows, i18n |
| **Paige** — Tech Writer | `bmad-agent-tech-writer` | Docs, README, runbooks |

## Layer-by-layer delivery (Alpha 0.0.1)

| Layer | Scope | Status |
|---|---|---|
| 0 | Repo bootstrap, Taskfile, `.env.example` | ✅ |
| 1 | Core infra — Traefik, Postgres, Redis, NATS | ✅ |
| 2 | Storage — MinIO + bucket policy | ✅ |
| 3 | Migrations — auth + ticket | ✅ |
| 4 | **Auth** service + RBAC + Argon2id + JWT | ✅ |
| 5 | **Ticket** service + SSE realtime + NATS events | ✅ |
| 6 | **Notify** — JetStream → Mailhog SMTP | ✅ |
| 7 | **Media** — MinIO + presigned URLs | ✅ |
| 8 | **Frontend** — Next.js 16, i18n (en/th/de), shadcn/ui | ✅ |
| 9 | **Observability** — Prometheus, Grafana, Loki, Promtail | ✅ |
| 10 | **Desktop** — Electron shell + release pipeline | ✅ |

## Verification with enterprise teams

Use these BMAD skills to verify governance before any production rollout:

```
bmad-help
bmad-code-review                # adversarial multi-layer review
bmad-check-implementation-readiness
bmad-validate-prd
bmad-review-adversarial-general
```

Each layer's runbook lives in [`docs/runbooks/`](../runbooks/) and stories
in [`docs/stories/`](../stories/).

---

*BMad Method is 100% free and open source — https://github.com/bmad-code-org/BMAD-METHOD*

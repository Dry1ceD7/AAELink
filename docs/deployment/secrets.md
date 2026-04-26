# Production deployment secrets

This document lists the secrets and environment variables required to run AAELink in production. Store values in your platform secret manager (Kubernetes Secrets, GitHub Actions secrets, Vault, or your cloud provider) and inject them at deploy time. Do not commit real credentials.

## Application (Next.js server)

| Variable | Required | Purpose |
|----------|----------|---------|
| `MATTERMOST_URL` | Yes | Base URL of the Mattermost API (internal service URL in cluster). |
| `MATTERMOST_WS_URL` | Yes | WebSocket URL for Mattermost (e.g. `wss://chat.example.com/api/v4/websocket`). |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Uses schema `aaelink` inside the same database as Mattermost or a dedicated database. |
| `S3_ENDPOINT` | Yes | S3-compatible API endpoint (MinIO, AWS S3, etc.). |
| `S3_ACCESS_KEY` | Yes | Object storage access key. |
| `S3_SECRET_KEY` | Yes | Object storage secret key. |
| `S3_BUCKET` | Yes | Bucket name for uploaded documents. |
| `S3_REGION` | Often | Region string (e.g. `us-east-1`); required by some SDKs even for MinIO. |
| `STIRLING_URL` | If OCR used | Internal URL of the Stirling-PDF service. |
| `NEXT_PUBLIC_APP_URL` | Yes | Public origin of the web app (for links and cookies). |

## GitHub Actions (if using CI in this repository)

Create encrypted secrets in the repository settings:

- `DATABASE_URL` – production or staging Postgres URL for migration checks (optional if tests use Docker only).
- `S3_*` – only if the workflow uploads artifacts to real object storage.
- `MATTERMOST_URL` / tokens – only for integration tests that hit a real Mattermost (not recommended for public forks).

For a typical `lint` + `build` workflow, no secrets are required unless you add deployment steps.

## Kubernetes (K3s example)

1. Copy `infra/k3s/secrets.example.yaml` to a file that is **gitignored** (e.g. `secrets.local.yaml`).
2. Replace placeholder values with base64-encoded strings (or use Sealed Secrets / External Secrets Operator).
3. Mount the same variable names into the AAELink deployment as environment variables.

Mattermost and PostgreSQL credentials must match what Mattermost expects (`MM_SQLSETTINGS_DATASOURCE`). The AAELink `DATABASE_URL` can point at the same Postgres server with schema `aaelink` created by the application on startup.

## Object storage

- Create the bucket ahead of time or allow the app to create it on first upload (MinIO: ensure policy allows `CreateBucket` for the app user).
- Prefer scoped IAM credentials with read/write limited to the documents bucket.

## Rotation

- Rotate `S3_SECRET_KEY` and database passwords on a regular schedule.
- After rotation, redeploy pods so they pick up new environment values.

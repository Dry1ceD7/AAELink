# Optional Kubernetes manifests

The manifests in this folder describe an **optional** upstream Team Chat stack (PostgreSQL, Redis, and related services) used historically for reference deployments.

The **AAELink** web application in this repository is a standalone Next.js app with its own API and PostgreSQL schema (`aaelink.*`). It does **not** require the services defined here to run locally (`npm run dev`) or in a minimal production setup.

Use these files only if you intentionally deploy the bundled reference stack. For application-only hosting, configure `DATABASE_URL` (and optional S3 variables for documents) per `docs/deployment/secrets.md`.

## See also

- [`../../docs/architecture-technical.md`](../../docs/architecture-technical.md) — Next.js app layers and APIs  
- [`../../docs/WHERE-IS-THE-ENGINE.md`](../../docs/WHERE-IS-THE-ENGINE.md) — when this k3s stack applies vs `npm run dev`  
- [`../../docs/README.md`](../../docs/README.md) — documentation index

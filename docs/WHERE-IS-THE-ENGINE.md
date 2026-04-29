# Where is the “whole” AAELink engine on my MacBook?

**AAELink** is the app name; **Advanced ID Asia Engineering Co., Ltd.** is the company line configured in `.env` / Compose (see `docs/BRANDING.md`).

The **`AAELink/`** folder holds **two runnable stories**: (1) **Compose + pinned Mattermost image** — the **Go + React engine source** is not copied here; upgrades stay one line in `docker-compose.yml`. (2) **Next.js** — the **root `README.md` product** (`app/`, `app/api/`, …) runs with `npm run dev` and does **not** need the Mattermost container for its own HTTP API. The **upstream megarepo** still lives under **`AAELinkPowered/vendor/upstream/`** when you clone it for engine work.

There are **four related things** people mean by “the app”:

| What | Where on your Mac | Visible in Git? |
|------|---------------------|-----------------|
| **Runnable AAELink** (Mattermost Team Edition: server + bundled web UI) | Docker: image `mattermost/mattermost-team-edition:11.6.1` + volumes (`docker volume ls` → `aaelink-*`) | No (inside Docker) |
| **Next.js AAELink** (root `README` product: pages + `app/api`, Postgres, SSE) | Same `AAELink/` folder: `npm run dev` or `next start` — not the Mattermost container’s HTTP stack | Yes — `app/`, `app/api/`, `lib/` |
| **Full upstream source** (Go server, `webapp/`, api, tests) | **`AAELinkPowered/vendor/upstream/`** after you clone (see below) | **No** — parent repo **gitignores `vendor/`**, so some editors **hide** this folder |
| **Deployment + docs** for Compose-based AAELink | `AAELink/` (Compose, `.env`, scripts, `docs/`) | Yes |

So: **`docker compose up`** runs the **pinned engine** image. **`npm run dev`** in `AAELink/` runs the **Next.js** implementation described in the root `README.md`. The **upstream Go/React source** for the engine lives under **`AAELinkPowered/vendor/upstream/`** — not under `AAELink/` itself.

**Map:** [`architecture-technical.md`](./architecture-technical.md) (Next stack), [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md) (engine pin + phases), hub [`architecture-ecosystem-map.md`](./architecture-ecosystem-map.md).

---

## 1. Confirm the engine is running (Docker)

```bash
cd /Users/d7y1ce/AAE/AAELink
docker compose ps
```

Open `http://localhost:8065` (or your `MM_SERVICESETTINGS_SITEURL`). That **is** the full web client + API backed by the image.

---

## 2. Put the full monorepo on disk (source you can open in Finder / Cursor)

From the workspace:

```bash
cd /Users/d7y1ce/AAE/AAELinkPowered
AAELINK_UPSTREAM_GIT_REF=v11.6.1 zsh scripts/clone-upstream-engine.zsh
```

Resulting tree (high level):

```text
AAELinkPowered/vendor/upstream/
  server/      # Go backend
  webapp/      # React client
  api/
  e2e-tests/
  tools/
```

Verify in Terminal:

```bash
ls /Users/d7y1ce/AAE/AAELinkPowered/vendor/upstream/server
ls /Users/d7y1ce/AAE/AAELinkPowered/vendor/upstream/webapp
```

---

## 3. If you “don’t see” `vendor/` in the editor

`AAELinkPowered/.gitignore` contains **`vendor/`**. Cursor / VS Code can **hide gitignored paths** from the sidebar.

**Option A — Show ignored files**

1. Open **Settings** (JSON or UI).
2. Search for **Exclude Git Ignore** (or `explorer.excludeGitIgnore`).
3. Turn **off** “Explorer: Exclude Git Ignore” for this workspace, **or** add a negated pattern if your team uses a custom `files.exclude`.

**Option B — Open the clone as its own folder**

**File → Open Folder…** →  
`/Users/d7y1ce/AAE/AAELinkPowered/vendor/upstream`  

You will see `server/`, `webapp/`, etc. like any other repo.

**Option C — Finder**

Open **`/Users/d7y1ce/AAE/AAELinkPowered/vendor/upstream`** in Finder (Go → Go to Folder…).

---

## 4. Why we do not copy the engine into `AAELink/`

- **Size** — millions of lines; would bloat every clone of your deployment repo.
- **Updates** — you bump the image tag and pull; no merge hell with a second copy of upstream.
- **Fork workflow** — when you need **custom builds**, you use a **GitHub fork** of the [public engine monorepo](https://github.com/mattermost/mattermost) and CI images, not a shadow tree inside `AAELink/` (see `../AAELinkPowered/CONTRIBUTING.md`).

---

## See also

- [`README.md`](./README.md) — documentation index  
- [`architecture-technical.md`](./architecture-technical.md) — Next.js layers and `app/api` map  
- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices  
- [`HOSTING-MACBOOK.md`](./HOSTING-MACBOOK.md) — LAN URL and migration  
- [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md) — what each slice is  
- [`../AAELinkPowered/VENDOR-UPSTREAM.md`](../AAELinkPowered/VENDOR-UPSTREAM.md) — short pointer from the AAELinkPowered repo root  

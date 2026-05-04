<div align="center">

<img src="public/brand/aae-logo.png" alt="AAELink" height="84"/>

# AAELink

**Enterprise SuperApp — Advanced ID Asia Engineering Co.,Ltd**

[![CI](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/ci.yml)
[![Desktop Build](https://github.com/Dry1ceD7/AAELink/actions/workflows/desktop-build.yml/badge.svg?branch=main)](https://github.com/Dry1ceD7/AAELink/actions/workflows/desktop-build.yml)
[![Latest release](https://img.shields.io/github/v/release/Dry1ceD7/AAELink?display_name=release&label=latest%20release&color=1e63b3)](https://github.com/Dry1ceD7/AAELink/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Dry1ceD7/AAELink/total?label=downloads&color=blue)](https://github.com/Dry1ceD7/AAELink/releases)
[![License](https://img.shields.io/badge/license-Proprietary-0a2342)](#license)

### Current version: **`v0.0.3-alpha`** &nbsp;·&nbsp; [Download installers](https://github.com/Dry1ceD7/AAELink/releases/latest) &nbsp;·&nbsp; [Release notes](https://github.com/Dry1ceD7/AAELink/releases/tag/v0.0.3-alpha)

</div>

---

## About

**AAELink** is the internal enterprise SuperApp for **Advanced ID Asia Engineering Co.,Ltd**.
It starts as an **IT Help Desk** and grows into a single place for the whole
company to work — tickets, files, notifications, identity, chat, and more.

The project ships as:

- **Docker Compose** for local dependencies (Postgres, MinIO, Stirling-PDF) and a **Next.js** app you run with **`npm run dev`** or **`npm run start`** on the host.
- **Native desktop clients** for **Windows 10/11** and **macOS**.
- A **modern web UI** accessible from any browser on the same network.

---

## Install the Desktop Client

Download the latest installer from the [Releases](https://github.com/Dry1ceD7/AAELink/releases/latest) page.

| Platform | File | Notes |
|---|---|---|
| Windows 10 / 11 | `AAELink-Setup-*.exe` | NSIS installer, 64-bit |
| macOS | `AAELink-*.dmg` | Drag to Applications |

### First Launch

1. Install and open AAELink.
2. On first launch, you'll see the **Connect to Server** screen.
3. Enter the server host's WiFi IP address (e.g. `192.168.11.80`).
4. Click **Connect** — the app loads and saves the address for next time.

> **Note:** Both your device and the server host must be on the **same WiFi network**.

---

## Current Features (Alpha 0.0.3)

- **IT Help Desk** — submit, comment, triage and resolve tickets with realtime updates.
- **Identity & access** — sign-in, sessions, four built-in roles: `super_admin`, `it_admin`, `it_employee`, `employee`.
- **Super-admin oversight** — cross-departmental visibility over every ticket, user, and module; protected against accidental lockout.
- **Admin panel** — user CRUD, department CRUD, custom role CRUD, permission assignment, webhook management.
- **Workspaces & channels** — team-based workspace organization with channel messaging, topic editing, bookmarks, and channel info panels.
- **Multi-Party Direct Messages** — robust group chat, user presence indicators (online/away/DND/offline), and inline document media previews.
- **Rich Messaging** — TipTap-powered composer with bold/italic/strikethrough/code formatting, @mention autocomplete, :emoji: inline autocomplete, message reactions (emoji picker), message forwarding, message pinning, threaded replies, and message drafts.
- **Slash Commands** — 21 built-in commands: `/shrug`, `/tableflip`, `/unflip`, `/me`, `/status`, `/dnd`, `/mute`, `/unmute`, `/remind`, `/topic`, `/join`, `/invite`, `/archive`, `/unarchive`, `/rename`, `/who`, `/collapse`, `/expand`, `/code`, `/clear`, `/help`. Autocomplete popup with keyboard navigation.
- **Channel Header Dropdown** — Chevron dropdown on the channel name: Star, Mute/Unmute, Copy Link, Invite People, Archive, Leave Channel.
- **Jump to Latest** — floating button appears when scrolled away from the bottom of the chat timeline.
- **New Messages Separator** — red divider line at the first unread message (Slack-style). Click to dismiss.
- **Channel Archive/Unarchive** — archive channels from the header dropdown or `/archive` command. `/unarchive` to restore.
- **User Profile Card** — local time display from timezone, DND badge, enhanced status.
- **Channel Browse** — Slack-style "Browse channels" modal for discovering and joining public channels with search, member count, and one-click join.
- **Auto-Away** — presence automatically switches to "away" after 5 min idle; restores to "online" on activity.
- **DND Schedule** — configurable Do Not Disturb hours in Settings. Notification sounds suppressed during schedule.
- **Custom Emoji** — upload, search, and manage custom workspace emoji from the workspace menu.
- **Search Highlighting** — matching terms highlighted in yellow in global search results.
- **Thread Follow/Unfollow** — follow/unfollow toggle in thread panel header for notification control.
- **Leave Confirmation** — confirmation dialog before leaving a channel, with rejoin instructions.
- **Sidebar Tooltips** — hovering channels in the sidebar shows purpose/description.
- **Message Reminders** — "Remind me in 30m/1h/4h" from the message More menu, or `/remind [minutes] [text]`. Fires as in-app notification.
- **Mark as Unread** — rewind the read cursor on any message so unread indicators re-appear in the sidebar.
- **Custom Status with Expiry** — set status text + emoji with auto-clear timer (Slack-style "Clear after…"). Via `/status`, `/dnd`, or the settings panel.
- **Channel Categories** — sidebar channel grouping API (Favorites, Channels, DMs, custom sections) with per-user sort ordering.
- **@here / @channel / @all** — group mentions with autocomplete and Slack-style amber highlight rendering.
- **Link Previews** — automatic URL unfurling with OpenGraph title/description/image cards inline in messages.
- **Search & Navigation** — Quick Switcher (⌘K), global full-text message search (⌘⇧F), keyboard shortcuts reference (⌘/), and channel details toggle (⌘.).
- **File Management** — drag-and-drop file upload with progress bars, file attachment cards, presigned S3 downloads via MinIO.
- **Notifications** — realtime in-app alerts via SSE, per-channel notification preferences, typing indicators.
- **Notification Sounds** — Web Audio API chime (Default/Subtle/None) with volume slider in Settings. No external audio files needed.
- **Scheduled Messages** — send-later date/time picker in the composer for deferred delivery.
- **Emergency IT support** — OTP-verified login screen request queue for urgent access help.
- **Documents foundation** — document upload/download with PDF operation queues.
- **Native desktop clients** — Windows `.exe` installer and macOS `.dmg` with auto-update support.
- **WiFi/LAN deployable** — one host can serve the whole office for alpha testing.

---

## Roadmap

| Status | Item |
|---|---|
| Shipped (Alpha 0.0.3) | IT Help Desk, identity, admin panel, file uploads, desktop clients, emergency support, documents, group chat, direct messages, channels, SSO (Microsoft Entra ID) |
| Next | Approvals and workflows |
| Later | Knowledge base / wiki |
| Later | Calendar, leave requests, attendance |
| Later | HR, finance and procurement integrations |
| Later | Mobile clients (iOS, Android) |

---

## Stack

| Layer | Technology |
|---|---|
| App server | **Next.js 16** (App Router + Route Handlers), **Node.js 22** |
| Web UI | React 19, TypeScript |
| Desktop | Electron (loads web UI URL; electron-builder installers) |
| Database | PostgreSQL 17 (schema `aaelink`; auto-migrated on startup) |
| Local deps | Docker Compose: Postgres, MinIO, Stirling-PDF |
| File storage | S3-compatible API (MinIO in dev) |

---

## Run the Server (Local Development)

### Prerequisites

- [Node.js](https://nodejs.org/) 22+ (LTS recommended)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) for Compose services
- [Git](https://git-scm.com/)

### Steps

```bash
git clone https://github.com/Dry1ceD7/AAELink.git
cd AAELink
cp .env.example .env
# Edit .env: set secrets, DATABASE_URL, S3_* as needed.
npm run docker:up
npm ci
AAELINK_SEED_ADMIN_PASSWORD='choose-a-long-password' npm run seed:platform-admin
npm run dev
```

The seed step creates the platform super-admin (`adminaaelink` / `adminaaelink@aae.co.th`).

| What | URL / Port |
|---|---|
| AAELink (Next.js) | http://localhost:3040 |
| PostgreSQL | `127.0.0.1:25432` |
| MinIO S3 API | `http://127.0.0.1:29000` (console `:29001`) |
| Stirling-PDF | `http://localhost:28085` |

### Serve Other Devices on WiFi

To let other PCs or the desktop client connect over WiFi:

```bash
npm run dev:wifi:auto
```

This binds the server to `0.0.0.0:3040`, detects your WiFi IP, and configures everything automatically. Other devices connect to `http://<YOUR_WIFI_IP>:3040`.

> **Tip:** Make sure macOS firewall allows connections on port 3040.

---

## Project Structure

```
AAELink/
├── app/               # Next.js App Router: pages, layouts, API routes
├── lib/               # Shared libraries (API client, realtime, migrations)
├── public/            # Static assets and branding
├── desktop/           # Electron desktop shell
├── scripts/           # Tooling (seed scripts, dev helpers)
├── docs/              # Documentation
├── docker-compose.yml # Postgres, MinIO, Stirling-PDF
├── package.json       # npm run dev / build / start
└── .github/workflows/ # CI / Desktop build
```

---

## License

Proprietary — © Advanced ID Asia Engineering Co.,Ltd. All rights reserved.

This software, including its source code, binaries, designs, and documentation,
is the confidential property of **Advanced ID Asia Engineering Co.,Ltd** and is
intended solely for internal use by employees and authorized partners. No part
of this project may be copied, redistributed, sublicensed, or used outside of
Advanced ID Asia Engineering Co.,Ltd without prior written permission.

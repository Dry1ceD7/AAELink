# North Star — Native collaboration hub

**AAELink** (this Next.js app) is the primary product: **workspaces**, **channels**, **messages**, **tickets**, and **documents** are implemented here against **PostgreSQL** (schema `aaelink`) and optional S3-compatible storage.

## Realtime

The web client opens **Server-Sent Events** on [`/api/collab/events`](../app/api/collab/events/route.ts) for the selected channel (cookies carry the session). If `EventSource` is unavailable, it falls back to polling via [`/api/messages`](../app/api/messages/route.ts).

## Registration

When `AAELINK_OPEN_REGISTRATION` is unset or not `0`, anyone can register. Set `AAELINK_OPEN_REGISTRATION=0` to block new signups once at least one user exists (the first account can still be created while the user table is empty).

## See also

- [`architecture-technical.md`](./architecture-technical.md) — layers, module→API map, scale path  
- [`README.md`](./README.md) — documentation index (this folder)

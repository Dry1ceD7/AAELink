# AAELink branding

This deployment sets **AAELink** as the product name and **Advanced ID Asia Engineering Co., Ltd.** as the company line on the login screen, and repoints **support and app-store links** to your `MM_SERVICESETTINGS_SITEURL` so users are not sent to the vendor’s public marketing site for those entries.

## What Compose already sets

| Area | Environment variables |
|------|------------------------|
| Product name | `MM_TEAMSETTINGS_SITENAME` |
| Login sidebar text | `MM_TEAMSETTINGS_ENABLECUSTOMBRAND`, `MM_TEAMSETTINGS_CUSTOMBRANDTEXT`, `MM_TEAMSETTINGS_CUSTOMDESCRIPTIONTEXT` |
| Legal / help / about / report links | `MM_SUPPORTSETTINGS_*` (currently all equal to `MM_SERVICESETTINGS_SITEURL` until you publish real pages) |
| “Ask the community” | `MM_SUPPORTSETTINGS_ENABLEASKCOMMUNITYLINK=false` |
| Mobile “get the app” links | `MM_NATIVEAPPSETTINGS_*` → same as Site URL (use the web client or replace with your own store links) |
| In-product notices feed | `MM_ANNOUNCEMENTSETTINGS_ADMINNOTICESENABLED`, `MM_ANNOUNCEMENTSETTINGS_USERNOTICESENABLED` → `false` |
| Server diagnostics | `MM_LOGSETTINGS_ENABLEDIAGNOSTICS=false` |
| Email feedback name / org | `MM_EMAILSETTINGS_FEEDBACKNAME`, `MM_EMAILSETTINGS_FEEDBACKORGANIZATION` |

## Login page logo (replace upstream artwork)

There is **no stable env var** for the custom brand **image** in all releases; upload it in the UI:

1. Sign in as a system administrator.
2. Open **System Console → Site Configuration → Customization**.
3. Enable **Custom Branding** (already on from Compose) and upload **Custom Brand Image** (follow on-screen format guidance, often JPG/PNG).

After upload, the login page shows your logo instead of the default artwork.

## Extension marketplace

`MM_PLUGINSETTINGS_MARKETPLACEURL` is left at the **upstream** default so the extension catalog keeps working. Hosting your own marketplace is a separate project; do not change this URL unless you operate a compatible registry.

## Honest limits

- Some **strings and icons** are still embedded in the shipped web bundle and mobile apps; you cannot rename every internal identifier without **building a custom fork** of the upstream monorepo.
- Pointing Terms/Privacy/About to `SiteURL` is a **placeholder** until you publish real policy pages and set those URLs in **System Console** (or add explicit `MM_SUPPORTSETTINGS_*` overrides in `.env`).

## Trademark

**AAELink** (app) and **Advanced ID Asia Engineering Co., Ltd.** (company) are your brands in this deployment. Marks and notices belonging to the **upstream engine vendor** still apply to **their** stock binaries and to content inside the cloned source tree; see `../AAELinkPowered/CONTRIBUTING.md` when you fork or redistribute binaries.

## See also

- [`ROADMAP-PHASES-AND-LAYERS.md`](./ROADMAP-PHASES-AND-LAYERS.md) — phases vs stack slices; **Identity** slice  
- [`ARCHITECTURE-AAELINK-STACK.md`](./ARCHITECTURE-AAELINK-STACK.md) — what the engine stack contains (server, web client, DB, plugins, calls, mobile) and how that maps to **AAELink** without a full rewrite.

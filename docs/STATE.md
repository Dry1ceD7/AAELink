# AAELink State

Read at session start. Update with /handoff before ending a session.
Non-personal voice. No emojis.

## Done
- Consolidated agents and skills into a single .claude registry.

## In progress
- npm to Bun migration (see MIGRATION.md, Part A).
- Archiving .agents, .kiro, _bmad, _skills-import (see MIGRATION.md, Part B).

## Next
- Fill the two MCP placeholders in .mcp.json from the working Kiro config.
- Run /gates to confirm a green baseline after the Bun cutover.

## Watch
- Oversized files pending refactor: lib/infra/migrate.ts (111KB),
  app/home/page.tsx (84KB), components/tickets/TicketsPanel.tsx (63KB),
  components/modals/PreferencesModal.tsx (61KB), app/styles.css (461KB).
- electron-builder may still require npm; verify during the Bun cutover.

# Standalone frontend over InvenTree's REST API, not an InvenTree plugin

The Owner's frontend is our own app, served on the same origin as InvenTree (a path such as `/app` behind the existing Caddy), that reads and writes InvenTree only through its REST API using a client generated from InvenTree's OpenAPI schema. InvenTree's own UI stays at `/web` for admin work the frontend doesn't cover.

## Considered Options

- **InvenTree plugin pages (UserInterfaceMixin):** rejected. Pages must be built with InvenTree's React/Mantine stack inside its navigation shell, which fights a custom design from Claude Design, and plugin installs are fiddly to keep alive across Docker container rebuilds.

## Consequences

- Phase 2 (Projects, tool assignment, check-ins, Quotations, WhatsApp) needs its own data and a server for WhatsApp webhooks whichever option we picked, so the plugin route would not have saved a backend. Where that data lives is a phase 2 decision.
- Being on the same origin, the Owner signs in with their InvenTree account and the frontend uses InvenTree's session cookie: no separate accounts and no tokens stored in the browser.
- The frontend depends on InvenTree's API contract, so the InvenTree image tag is pinned and upgraded deliberately.

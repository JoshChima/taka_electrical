# Taka Electrical Inventory

Local [InvenTree](https://inventree.org) inventory system for an electrical contractor, run with Docker Compose.
It ships with a demo dataset: electrician parts and materials, suppliers, customers, service-van and job-site stock,
install kits with bills of materials, and four sample electrical projects with their purchase, sales and build orders.

`docker-compose.yml`, `Caddyfile` and `.env.example` are based on InvenTree's official
[`contrib/container`](https://github.com/inventree/InvenTree/tree/stable/contrib/container) files (MIT licensed),
following the [Docker install guide](https://docs.inventree.org/en/stable/start/docker_install/).

## Requirements

- Docker Desktop (or Docker Engine) with Docker Compose v2
- Ports 80 and 443 free on the host
- Node.js 20+ and npm, to build the Owner stock app

## Setup

```bash
cp .env.example .env
```

Edit `.env` and set `INVENTREE_DB_PASSWORD` to a long random value (for example `openssl rand -hex 16`).
Compose refuses to start while it is blank.

```bash
npm --prefix frontend ci
npm --prefix frontend run build
docker compose run --rm inventree-server invoke update
docker compose run --rm inventree-server invoke superuser
docker compose up -d
```

- The Owner stock app: http://localhost/app/ (sign in with the InvenTree account you created).
- InvenTree's own UI, for admin work: http://localhost/web/

InvenTree is pinned to 1.6.0 (`INVENTREE_TAG`), because the app is built against that version's API.
If you have an older `.env` with `INVENTREE_TAG=stable`, change it to `1.6.0`.

## The Owner stock app (`frontend/`)

A Vite + React + TypeScript single-page app for the Owner's everyday stock jobs (see
[ADR-0001](docs/adr/0001-standalone-frontend-over-rest-api.md)). It talks to InvenTree only through its REST API and
uses InvenTree's own session login. Caddy serves the built files from `frontend/dist` at `/app`, on the same origin
as InvenTree. After rebuilding, just reload the page; no container restart is needed.

```bash
cd frontend
npm ci
npm test               # test seam 1: the app against a fake InvenTree (no Docker needed)
npm run build          # type-checks and builds to dist/, which Caddy serves at /app
npm run dev            # dev server on http://localhost:5173/app/, proxying /api to InvenTree at http://localhost
```

- **API client**: typed from InvenTree's OpenAPI schema, `frontend/inventree-openapi-1.6.0.json`. `npm run build`
  regenerates the types (`npm run generate:api`); they are not committed. Replace the schema only when upgrading
  InvenTree on purpose.
- **Stock rules**: `src/stock-rules.ts` turns raw InvenTree data into what the screens show. Every screen reads
  through it.
- **Test fixtures**: `src/test/seed-fixtures.json` is generated from `seed/seed_electrical.py`
  (`npm run generate:fixtures`, needs Python). Regenerate after changing the seed.
- **Smoke test** (test seam 2, exactly one test): signs in to the real stack and checks the overview. With the
  stack running and the demo seed loaded:

  ```bash
  npx playwright install chromium   # once
  SMOKE_BASE_URL=http://localhost SMOKE_USERNAME=<user> SMOKE_PASSWORD=<password> npm run test:smoke
  ```

  Without those variables the test is skipped.

## Demo dataset

`seed/seed_electrical.py` loads the demo data. The one-shot `inventree-seed` service runs it on every
`docker compose up`:

- On an empty database it creates everything in a single transaction.
- If the data is already present it does nothing, so your edits are never overwritten.

To change the dataset, edit the tables at the top of the script. All companies, people and addresses are fictional.

## Data and secrets

All persistent data lives in `./inventree-data/`: the database, uploaded files, the Django secret key and the OIDC
signing key. That folder and `.env` are excluded by `.gitignore` and must never be committed. Back up
`inventree-data/` to keep your inventory.

This setup is intended for local use. Before exposing it to a network, review InvenTree's
[threat model](https://docs.inventree.org/en/stable/concepts/threat_model/) and configure HTTPS via `INVENTREE_SITE_URL`.

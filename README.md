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

## Setup

```bash
cp .env.example .env
```

Edit `.env` and set `INVENTREE_DB_PASSWORD` to a long random value (for example `openssl rand -hex 16`).
Compose refuses to start while it is blank.

```bash
docker compose run --rm inventree-server invoke update
docker compose run --rm inventree-server invoke superuser
docker compose up -d
```

Open http://localhost and log in with the account you created.

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

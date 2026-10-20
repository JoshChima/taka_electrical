# Running Taka Electrical on your own Windows PC

This guide gets the whole system running on a Windows PC from scratch: InvenTree (the inventory backend) with the
demo data, and the Owner stock app on top of it. It assumes you know your way around Git, a terminal and an IDE, and
that you have never used Docker. Plan on about an hour the first time, most of it waiting for installs and downloads.

Everything runs on your own machine. Nothing is exposed to the internet, and every company, person and password in the
demo data is fictional.

## 1. What you are setting up

There are two parts:

- **InvenTree** is an open-source inventory system: a Python/Django server with a REST API and a PostgreSQL database.
  We don't modify it; we run the official release (version 1.6.0) as-is.
- **The Owner stock app** (`frontend/`) is our own React + TypeScript app. It covers the five everyday jobs of the
  business owner: stock overview, find a part, move stock, reorder, receive a delivery. It has no server of its own: it
  is a set of static files that talks to InvenTree's API.

When it's running you open two addresses in your browser:

| Address | What it is |
|---|---|
| http://localhost/app/ | The Owner stock app (what the client sees) |
| http://localhost/web/ | InvenTree's own admin UI (adding parts, suppliers, users, settings) |

### Docker in five minutes

Docker runs programs in **containers**: isolated Linux environments that come with everything the program needs, so
you don't install Python, PostgreSQL or a web server on Windows yourself.

| Term | What it means here |
|---|---|
| **Image** | A read-only template for a container, downloaded from Docker Hub. We use four: `inventree/inventree:1.6.0`, `postgres:17`, `redis:7-alpine` and `caddy:alpine`. |
| **Container** | A running instance of an image. Containers are disposable: deleting one loses nothing, because the data lives outside them (see *Bind mount*). |
| **Docker Compose** | Starts and connects several containers from one file, `docker-compose.yml`. You mostly use `docker compose up -d` and `docker compose down`. |
| **Service** | One entry in `docker-compose.yml`, which becomes one container. |
| **Bind mount** | A folder on your PC that a container sees as one of its own folders. Ours: `inventree-data/` (all data), `seed/` (demo data script), `frontend/dist/` (the built app) and `Caddyfile`. |
| **`.env`** | A settings file Compose reads when it starts. It holds the database password, so it is never committed. |
| **Docker Desktop** | The Windows app that runs Docker. It runs Linux in the background through WSL 2 (Windows Subsystem for Linux). |

### The six services

| Service | Image | Job |
|---|---|---|
| `inventree-db` | postgres:17 | The database. Its files live in `inventree-data/pgdb/`. |
| `inventree-cache` | redis:7-alpine | A cache that speeds InvenTree up. Holds nothing you need to keep. |
| `inventree-server` | inventree:1.6.0 | InvenTree's web server and REST API (port 8000, only inside Docker). |
| `inventree-worker` | inventree:1.6.0 | InvenTree's background task runner. |
| `inventree-seed` | inventree:1.6.0 | Runs `seed/seed_electrical.py` once on every start, then stops. On an empty database it loads the demo data; otherwise it does nothing. Seeing it as "Exited (0)" is normal. |
| `inventree-proxy` | caddy:alpine | The front door, published on ports 80 and 443 of your PC. It serves the Owner app from `frontend/dist` at `/app` and passes everything else to `inventree-server`. |

They start in order: the database and cache first, then the server once both are healthy, then the worker, seed and
proxy once the server is healthy.

## 2. Install the tools (once)

1. **Turn on virtualization.** Docker needs it. Open Task Manager → Performance → CPU and check that
   "Virtualization: Enabled". If it says Disabled, turn on Intel VT-x or AMD-V/SVM in your BIOS/UEFI settings.
2. **Install WSL 2.** Open PowerShell **as Administrator** and run:

   ```powershell
   wsl --install
   ```

   Restart when asked. If WSL is already installed, `wsl --update` brings it up to date.
3. **Install Docker Desktop** from https://www.docker.com/products/docker-desktop/. During install keep
   "Use WSL 2 instead of Hyper-V" ticked. Start Docker Desktop and wait until the whale icon in the system tray says
   *Docker Desktop is running*. Docker Desktop must be running whenever you use the system.

   Check it from a new PowerShell window:

   ```powershell
   docker --version
   docker compose version
   ```

   Both should print a version (Compose must be v2).
4. **Install Git** (https://git-scm.com/download/win) if you don't have it.
5. **Install Node.js 20 or newer** (LTS from https://nodejs.org). npm comes with it. `node --version` should print
   `v20` or higher.

All commands below are for **PowerShell**, run from the repository folder.

## 3. Get the code

```powershell
git clone https://github.com/JoshChima/taka_electrical.git
cd taka_electrical
```

Clone somewhere short and without spaces, for example `C:\dev\taka_electrical`.

## 4. Create `.env`

```powershell
Copy-Item .env.example .env
```

Open `.env` in your editor and set `INVENTREE_DB_PASSWORD` to a long random value. To generate one:

```powershell
[guid]::NewGuid().ToString('N')
```

Leave everything else as it is. Two values matter later:

- `INVENTREE_TAG=1.6.0`: the InvenTree version. The Owner app is built against this version's API, so don't change it.
- `INVENTREE_SITE_URL="http://localhost"`: the address you use in the browser. It must match exactly (see
  *Ports 80 or 443 are taken* below if you need another port).

> **Choose the database password once.** PostgreSQL stores it the first time the database is created, in
> `inventree-data/pgdb/`. If you change it in `.env` afterwards, InvenTree can no longer log in to its own database
> (see *Troubleshooting*). Pick it now and leave it.

`.env` is excluded by `.gitignore`, so it never gets committed.

## 5. Build the Owner stock app

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
```

`ci` installs the exact dependency versions from `package-lock.json`. `build` generates the API types from InvenTree's
schema, type-checks, and writes the app to `frontend/dist/`, which the proxy serves at `/app`.

## 6. First start

The first time only, create the database tables and an admin account. Docker downloads the images on the first
command, roughly 1 GB, so it can take a few minutes.

```powershell
docker compose run --rm inventree-server invoke update
docker compose run --rm inventree-server invoke superuser
```

- `invoke update` creates the database and all its tables, and collects InvenTree's static files. `run --rm` starts a
  one-off container for the command and deletes it afterwards.
- `invoke superuser` asks for a username, email and password. **This is the account you sign in with**, in both the
  Owner app and InvenTree's UI. The demo data has no users of its own.

Then start everything:

```powershell
docker compose up -d
```

`-d` ("detached") returns your terminal once the containers have started. Startup takes one to two minutes. Watch it:

```powershell
docker compose ps
```

You're ready when `inventree-db`, `inventree-cache`, `inventree-server`, `inventree-worker` and `inventree-proxy` say
`(healthy)`, and `inventree-seed` says `Exited (0)`. To confirm the demo data loaded:

```powershell
docker compose logs inventree-seed
```

The last lines say the data was created, or "already present - nothing to do" on later starts.

## 7. Use it

- Open **http://localhost/app/** and sign in with the superuser you created. The overview should say
  **5 parts below Minimum Stock**.
- InvenTree's own UI is at **http://localhost/web/**, with the same account.

The words in the app (Owner, Van, Job Site, Project, Minimum Stock, On Order) are defined in
[`GLOSSARY.md`](../GLOSSARY.md).

## 8. Day to day

| To… | Run |
|---|---|
| Start the system | `docker compose up -d` (Docker Desktop must be running) |
| Stop it (keeps all data) | `docker compose down` |
| See what's running | `docker compose ps` |
| Follow a service's logs | `docker compose logs -f inventree-server` (Ctrl+C to stop following) |
| Restart one service | `docker compose restart inventree-proxy` |
| Get the latest code | `git pull`, then `npm --prefix frontend ci`, `npm --prefix frontend run build`, `docker compose up -d` |

After rebuilding the app, a browser refresh is enough; nothing needs restarting. Docker Desktop's dashboard shows the
same containers and logs, if you prefer clicking.

All data (database, uploads, InvenTree's secret key) lives in `inventree-data/`. To back up, stop the system and copy
that folder.

## 9. Starting over with fresh demo data (optional)

This **deletes everything** in the system: the demo data, anything you changed, and your admin account. Do it when
you want a clean demo, or after changing the seed data in `seed/seed_electrical.py`, which only loads into an empty
database.

```powershell
docker compose down
Remove-Item -Recurse -Force inventree-data
docker compose run --rm inventree-server invoke update
docker compose run --rm inventree-server invoke superuser
docker compose up -d
```

Deleting `inventree-data` also deletes the stored database password, so this is also the way out if you need to
change `INVENTREE_DB_PASSWORD`.

## 10. Working on the app

```powershell
cd frontend
npm test          # the app against a fake InvenTree; no Docker needed
npm run dev       # live-reloading dev server at http://localhost:5173/app/, using the running InvenTree's API
```

`npm run dev` needs the Docker stack running, because it passes `/api` calls through to InvenTree on
`http://localhost`. See the README for the smoke test and the other scripts.

### The project's agent files

If you use Claude Code (or another coding agent) in this repo, these files are part of the setup and are committed
on purpose:

- [`CLAUDE.md`](../CLAUDE.md) is loaded automatically into every Claude Code session here. It points the agent at the
  issue tracker, the triage labels and the domain docs.
- [`GLOSSARY.md`](../GLOSSARY.md) is the project's shared vocabulary. Code, tickets and agents all use its terms.
- [`docs/adr/`](adr/) records decisions that are hard to reverse, such as why the app is separate from InvenTree.
- [`docs/inventree-api.md`](inventree-api.md) lists verified facts about InvenTree 1.6.0's API that aren't obvious
  from its docs.

## Troubleshooting

### `inventree-server` stays unhealthy: `password authentication failed for user "inventree"`

Run `docker compose logs inventree-server`. If the last lines say `password authentication failed`, the password in
`.env` no longer matches the one PostgreSQL stored when the database was first created. Either:

- put the original password back in `.env` and run `docker compose up -d` again, or
- keep the new password and tell PostgreSQL about it (keeps all data):

  ```powershell
  docker compose up -d inventree-db
  'ALTER ROLE :"u" PASSWORD :''pw'';' | docker exec -i inventree-db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -v u=$POSTGRES_USER -v pw=$POSTGRES_PASSWORD'
  docker compose restart inventree-server
  docker compose up -d
  ```

  It prints `ALTER ROLE` when it works. It copies the password the database container received from `.env` into
  PostgreSQL, without printing it. (It relies on the password being letters and digits only, as the generator in step 4 makes.)

### `dependency failed to start: container inventree-server is unhealthy`

This only says that the server didn't come up; the reason is in `docker compose logs inventree-server`. Start from
the last error there. The password problem above is the most common one. On the very first start, a missing
`invoke update` (step 6) is the next most likely.

### Ports 80 or 443 are taken

`docker compose up` fails with "port is already allocated" or "bind: An attempt was made to access a socket…". Another
program (IIS, Skype, another web server, another Docker project) is using the port. Either stop that program, or move
this system to other ports in `.env`:

```dotenv
INVENTREE_HTTP_PORT=8080
INVENTREE_HTTPS_PORT=8443
INVENTREE_SITE_URL="http://localhost:8080"
```

Then use http://localhost:8080/app/. `INVENTREE_SITE_URL` must match the address in your browser exactly, or sign-in
fails with a CSRF error.

### `docker` isn't recognised, or "Cannot connect to the Docker daemon"

Docker Desktop isn't running. Start it from the Start menu and wait for *Docker Desktop is running*, then open a new
PowerShell window.

### Docker Desktop won't start, or complains about WSL

Run `wsl --update` in an Administrator PowerShell and restart. Check that virtualization is enabled (step 2.1).

### `/app` shows a blank page or a 404

The app hasn't been built, or the proxy can't see the build. Run `npm --prefix frontend run build`, then
`docker compose restart inventree-proxy`, and refresh the page.

### Sign-in fails with the right password

Make sure you're signing in with the superuser from step 6, and that the browser address matches `INVENTREE_SITE_URL`
(`http://localhost`, not `http://127.0.0.1`).

### "Receive" shows PO-0002 as 1,250,000 ft

The database was seeded by an older version of the seed script, which counted reels as feet. Starting over (step 9)
loads the corrected data.

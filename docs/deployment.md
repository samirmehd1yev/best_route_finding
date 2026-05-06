# Deployment Guide

The app is a normal Next.js Node application backed by a local SQLite file.
There is no external database to provision and no GitHub Action to wire up.
Anywhere that runs Node 20+ will host it.

## Prerequisites

- Node.js 20+ (or 22+) on the host
- A populated `./data/ayna.sqlite` file produced by the Python scrapers
  (see [scraping docs](scraping/run_migrations.md))

## Environment Variables

There is exactly one optional setting:

| Variable | Description | Default |
|----------|-------------|---------|
| `SQLITE_DB_PATH` | Override the SQLite database file location | `./data/ayna.sqlite` |

## Building Locally First

Always build the database **before** deploying — the app expects the file
to exist at runtime.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/run_migrations.py
python scripts/stops.py
python scripts/busDetails.py
```

`./data/ayna.sqlite` is the artifact you ship with the build.

## Build Configuration

```
Framework Preset:  Next.js
Build Command:     next build
Output Directory:  .next
Install Command:   npm install
Node.js Version:   20.x or 22.x
```

`better-sqlite3` is a native module and ships pre-built binaries for the
mainstream Node versions. If your host runs a non-standard libc/Node combo
the install step will compile from source — install build tools (`gcc`,
`make`, Python) on the build image.

## Deployment Targets

### Self-hosted / VPS / container

```bash
git clone <repo> && cd best_route_finding
npm install
# Copy your prebuilt SQLite file in:
mkdir -p data
cp /path/to/ayna.sqlite data/
npm run build
npm start    # or run via pm2 / systemd / a Dockerfile
```

`SQLITE_DB_PATH` lets you keep the database in `/var/lib/baku-bus/` while
the app sits in `/opt/baku-bus/`.

### Vercel / Netlify / serverless

Bundle `data/ayna.sqlite` with the deployment (it's a regular file, not a
build artefact, so add it to your repo or copy it during the build step).
The runtime file system is read-only on these platforms — that's fine
because `db.ts` opens the file in read-only mode.

To refresh data, re-run the scrapers locally and redeploy with the new
`data/ayna.sqlite`.

### Docker

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY data/ayna.sqlite ./data/ayna.sqlite
EXPOSE 3000
CMD ["npm", "start"]
```

## Production Readiness Checklist

- [x] SQLite file built and shipped with the deployment
- [x] No external secrets needed
- [x] Error handling on all API routes
- [x] Input validation on all endpoints
- [x] Pagination opt-in on `/api/stops`
- [x] Responsive design tested
- [x] Build succeeds with zero warnings
- [x] TypeScript strict mode enabled
- [x] Atomic ingest pipeline (failed scrapes don't corrupt the DB)

## Performance Notes

- **Cold start:** First request after the process starts builds the
  transit graph (~2–5 s). Subsequent requests reuse the cached graph.
- **Graph size:** ~3,444 nodes, ~11,000+ edges (bus routes + walking
  transfers). Fits easily in any host's memory.
- **Database driver:** `better-sqlite3` is synchronous and extremely fast
  for read workloads (single-digit microseconds per prepared statement).
  WAL journal mode is enabled.
- **Static assets:** Served via your host's CDN (Vercel/Netlify do this
  automatically; on a VPS, put a CDN such as Cloudflare in front).

## Monitoring

- Standard Next.js logs surface API errors and the graph-build banner
  (`Graph built: N nodes, M edges`).
- For production, point the process at any log shipper (Datadog,
  Logtail, Loki, etc.).
- File-system monitoring on `data/ayna.sqlite` lets you alert on
  unexpected size changes.

## Refreshing Data

There is no longer a GitHub Actions cron. Refresh data manually:

```bash
source .venv/bin/activate
python scripts/stops.py
python scripts/busDetails.py
git add data/ayna.sqlite        # or rsync to your host
git commit -m "Refresh transit data"
# trigger redeploy
```

Both scrapers wrap their writes in a single transaction, so a network
failure mid-run leaves the on-disk database untouched.

## Scaling Considerations

Future growth ideas:

- **Real-time data:** Add WebSocket support for live bus tracking (would
  require a writable DB or a separate service).
- **Multi-region:** Replicate the SQLite file to each edge node — it's
  immutable at runtime, so this is trivial.
- **Bigger graphs:** SQLite handles millions of rows comfortably; the
  bottleneck would be the in-memory graph, not the database.
- **Live ETAs:** Add per-segment timing data to `bus_stops`
  (`segment_minutes` column) and replace the uniform-per-route estimate
  in `graph.ts`.

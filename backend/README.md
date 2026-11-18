# DuoQ Lab shared-library backend

This directory contains the complete Vinext / Cloudflare Workers application used by the dashboard's shared replay-statistics library, including its lockfile, SQL migrations, build integration and development tools.

The source was imported from the running Sites project's commit `83a62e4779087b29ab4d5db5008c6f4fd9dea4f3`. GitHub is now the shared place to review changes. Deploying the existing Sites service remains a separate operation; see [DEPLOYMENT.md](DEPLOYMENT.md).

## Run locally

Requirements: Node.js 24 and npm. No ChatGPT account, Cloudflare login or production credentials are required for local development.

From the repository root:

```sh
cd backend
npm ci --ignore-scripts --include=dev --include=optional
npm run db:migrate:local
npm run dev
```

Open the local URL printed by Vinext, normally `http://localhost:5173`. The API is at `/api/replays`. The development server and migration command share the same ignored local database under `.wrangler/state`.

To check and preview a production build:

```sh
npm run typecheck
npm run build
npm start
```

`npm start` serves the built Worker locally; it does not publish it. The GitHub workflow [backend.yml](../.github/workflows/backend.yml) installs the locked dependencies, checks types, applies the schema to a local database and builds the application.

## API

| Request | Behaviour |
| --- | --- |
| `GET /api/replays?offset=0` | Returns up to 200 summaries and a `next` cursor, or `null` at the end |
| `POST /api/replays` | Accepts a validated JSON summary up to 96 KiB; appends a new match or returns its existing record |
| `OPTIONS /api/replays` | Public CORS preflight |

Only Steam IDs `76561198058377116` and `76561198060138310` are accepted. Match IDs are normalised to uppercase. Existing replay records are never overwritten by imports. A real replay can upgrade a scoreboard-only live record. Matching live records may combine target-player coverage; compare-and-swap updates protect concurrent uploads. This is a public submissions API: anyone can submit a valid summary. Submissions come from browser analysis and are not independently verified by a game server.

Original replay files are parsed in the visitor's browser. The API keeps compact results, strips local filenames/titles and source URLs, and fixes the two target display names. Credentials and local filesystem paths are not part of the stored summary.

## Source map

| Path | Purpose |
| --- | --- |
| `app/api/replays/route.ts` | HTTP endpoints, body limit, pagination and append-only storage |
| `lib/sanitize.ts` | Target-player and statistic validation |
| `lib/merge-summary.ts` | Live-record enrichment and replay precedence |
| `db/index.ts`, `db/schema.ts` | D1 connection and Drizzle schema |
| `drizzle/` | SQL migrations and Drizzle metadata |
| `worker/index.ts` | Production Worker entrypoint |
| `vite.config.ts`, `scripts/` | Framework, Cloudflare and Sites build integration |
| `.openai/hosting.json` | Existing Sites project identity and storage binding names; not an access credential |
| `wrangler.local.jsonc` | Local-only database configuration with a placeholder UUID |
| `package.json`, `package-lock.json` | Commands and reproducible dependency versions |
| `docs/STARTER.md` | Retained framework and optional integration documentation |

The copied starter includes optional UI components, connector helpers and local mock sign-in. The current replay API does not require those integrations or ChatGPT authentication.

## Schema changes

Edit `db/schema.ts`, then generate a migration:

```sh
npm run db:generate
npm run db:migrate:local
npm run typecheck
npm run build
```

Commit the generated SQL and Drizzle metadata together. Review migrations before applying them to a shared database.

## Deployment and data transfer

See [DEPLOYMENT.md](DEPLOYMENT.md) for the existing Sites service, independent Cloudflare hosting and exporting/importing public replay summaries. See the repository's [collaboration guide](../docs/COLLABORATION.md) for GitHub and hosting permissions.

The public frontend's API address is configured in `../src/shared-library.js`. Its default continues to point at the existing shared library.

# Shared replay-statistics API

The frontend runs on GitHub Pages; persistent community uploads use a Sites / Cloudflare Workers service with D1 storage.

* `GET /api/replays?offset=0`: up to 200 summaries with a `next` cursor.
* `POST /api/replays`: a validated DuoQ summary, at most 96 KiB. Only the two configured Steam IDs are accepted. New match IDs are appended; existing records are not overwritten.
* `OPTIONS /api/replays`: public CORS preflight.

`route.ts`, `sanitize.ts`, `schema.ts` and `schema.sql` contain the API logic and database schema. The full generated Vinext hosting project is supplied separately as the local `duoq-api` deliverable. It uses the supplied Sites build integration and applies the SQL migration during deployment. The endpoint is configured in `src/shared-library.js`.

Replay files are parsed in the visitor's browser. Only compact summaries are sent to this API, and public sharing is clearly indicated by the upload control. No original replay files, API credentials or local filesystem paths are stored. Community submissions are derived by the browser parser rather than independently verified by a game server.

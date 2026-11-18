# DuoQ Lab

A Rocket League dashboard for **Kate** (`76561198058377116`) and **P L 4 Y E R** (`76561198060138310`), with replay analytics, player comparisons and a shared public statistics library.

**[Open the dashboard](https://thepl4yer.github.io/duoq-lab/)** · [GitHub repository](https://github.com/thePl4yer/duoq-lab)

The frontend is a static website hosted on GitHub Pages. Replay files are analysed locally in the visitor's browser through WebAssembly. File analysis requires no server, API key or upload to a third party. An optional shared API stores compact statistics so other visitors can see them.

## Getting started

Requirements: Node.js 24 or newer and npm.

```sh
npm install --ignore-scripts
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:4173`. The `dist/` directory contains the publishable website. To serve the production build locally, run `npm run preview`.

The build copies the WebAssembly module from the pinned MIT-licensed dependency `@rlrml/subtr-actor@1.5.1`. Serve the website over HTTP(S): opening `index.html` directly through `file://` does not support module workers.

## Statistics views

- **Together:** both Steam IDs are on the same team. Both players share the same match selection.
- **Solo:** exactly one target player appears in the match. Each player has their own match count and winrate denominator.
- **Overall:** all available matches for each player, including matches together and matches against each other.

Date and game-mode filters apply to the statistics view. The replay library also has table filters and search. Import individual files, multiple files, a folder or a drag-and-drop selection. Files containing neither target Steam ID are skipped after their metadata is checked.

The dashboard displays games, wins, losses, winrate, goals, assists, shots, saves, demolitions, time-weighted average speed, time at supersonic speed, time in the air, boost collected per minute, boost stolen and stolen large/small pads. Bumps between the two players are estimated from vehicle movement, with data coverage shown alongside the result. Demolitions are counted separately.

### Kate's boost tax

The regular **boost stolen** statistic means boost collected in the opponent's half; it does not assign ownership of a pad to a particular teammate.

The extra **Kate's boost tax** statistic uses a conservative heuristic: Kate must actually collect the pad while PLAYER has less than 50 boost, is within 800 Unreal Units, and is driving toward the same pad at more than 300 uu/s with a directional cosine above 0.6. The most recent player-state sample must be no older than 0.15 seconds.

Only verified standard-map pad geometry is supported. Hoops remains unknown, and Dropshot is not applicable. The displayed value is an observed lower bound, not evidence of intention.

## Included dataset — 18 November 2026

The initial search found 362 local replay files in the user's home directory. Metadata was readable for 360 files: 355 contained at least one target player and five contained neither. All 355 relevant replays were fully analysed without analysis errors. Of these, 29 contain both players (28 on the same team and one on opposing teams), while 326 contain only PLAYER. No Kate-only local replays were available.

Five public Ballchasing replays, verified using both Steam IDs, were added: four Hoops matches and one Standard match. The combined dataset contains **360 unique matches**: **33 together**, **326 solo** and **one against each other**.

This is an available replay sample, not a complete account history. Saved replays may overrepresent wins. One damaged file has unknown player membership; another could not be read because of an unsupported game type. One diagnostic directory could not be accessed. The published dataset includes no original replay files, absolute local file paths or other players' profiles.

The public Standard replay reports unreliable boost data. Its boost values are excluded from boost aggregates; its movement statistics and match result remain included.

## Tracker Network data

`data/tracker.json` contains a dated snapshot captured on 18 November 2026: ranks and MMR for Standard, 2v2, Hoops, Dropshot, Snow Day and Rumble, season match counts, and lifetime wins. Direct HTTP requests to the profiles were blocked, so the snapshot was collected through the browser. The dashboard displays account totals separately from replay statistics.

Tracker groups activity into sessions. Session timestamps are collection times rather than match times. The visible profiles do not expose shared match IDs, teammate lists or complete corresponding loss counts, so they cannot establish exact Together/Solo/Overall winrates. In particular, lifetime wins must not be divided by current-season match counts. Replay winrates are labelled as a sample. Manual rank entries and Tracker JSON imports are supported.

### How updates work

- A visitor's replay statistics update immediately after an import finishes.
- With **Share analysed statistics publicly** enabled, compact summaries are added to the shared library. Other visitors receive them when they open or reload the dashboard.
- An already-open page does not poll for updates in the background.
- Tracker data is a static snapshot. Reloading the dashboard does not fetch fresh ranks from Tracker; the snapshot must be updated separately or ranks imported manually.
- New Rocket League matches and local replay files are not logged or imported automatically. Automatic Ballchasing API requests and replay downloads are not implemented; those integrations require a personal API key.
- Changes pushed to `main` trigger the GitHub Pages deployment workflow.

## Storage and sharing

The bundled `data/seed.json` is part of the public website. New replay files are analysed locally in the browser. With **Share analysed statistics publicly** enabled, compact summaries are stored in a shared D1 library and become visible to all visitors. Original replay files are never sent to that server.

The API accepts only statistics for Kate and PLAYER, validates format and size limits, and appends new match IDs. Existing records are not overwritten. The dashboard loads the shared library when the page opens. If the service is temporarily unavailable, the bundled dataset and local analysis remain usable, and failed publications can be retried.

With sharing disabled, imports remain in that browser's IndexedDB. Manual ranks are also stored locally. JSON export and import support backups and transfers, including Ballchasing replay-detail JSON imports. Resetting browser data does not delete entries already published to the shared library.

The complete backend project is included in [`backend/`](backend/README.md): API routes, validation, database schema and migrations, pinned dependencies, Worker entrypoint, framework configuration and build tools. The frontend connects to the API through `src/shared-library.js`.

## Working with collaborators

Clone this repository to develop both the frontend and backend. Start with the [collaboration guide](docs/COLLABORATION.md), then follow the [backend setup](backend/README.md) and [deployment guide](backend/DEPLOYMENT.md).

GitHub collaborator access grants source-code access; it does not grant administration of the current Sites service or its database. The backend can run locally without a ChatGPT account and can be deployed to your own Cloudflare account. Publishing changes to the existing Sites service requires separate Site editor access. Pushing backend changes to GitHub runs checks but does not deploy that service automatically.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Dashboard UI, aggregation, replay worker, Tracker display and boost-tax heuristic |
| `data/` | Bundled replay summaries, coverage notes and dated Tracker snapshot |
| `backend/` | Complete shared-library backend, dependencies, migrations and deployment instructions |
| `docs/` | Collaboration, ownership and handover guide |
| `tests/` | Statistics and boost-tax checks |
| `scripts/` | Local development server and static build |
| `assets/` | Dashboard artwork and its provenance |
| `.github/workflows/pages.yml` | Validation, build and GitHub Pages deployment |

## GitHub Pages

Live: [DuoQ Lab](https://thepl4yer.github.io/duoq-lab/).

The workflow at `.github/workflows/pages.yml` installs the pinned dependency, runs the statistics tests, builds `dist/` and publishes through GitHub Pages. In the repository, select **Settings → Pages → Source: GitHub Actions**. Relative asset paths support project URLs such as `https://<account>.github.io/duoq-lab/`.

## Sources and credits

- [subtr-actor](https://github.com/rlrml/subtr-actor), MIT, version 1.5.1: WebAssembly replay parser and derived events
- [Ballchasing API documentation](https://ballchasing.com/doc/api)
- Public replay sources linked in `data/seed.json` and each replay's detail view
- [Kate on Steam](https://steamcommunity.com/profiles/76561198058377116/)
- [PLAYER on Steam](https://steamcommunity.com/id/JustAHonestGuy/)
- [Artwork provenance](assets/ARTWORK.md)

An independent fan project. Rocket League® is a trademark of its respective owners.

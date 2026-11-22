# DuoQ Lab

Rocket League dashboard for **Kate** and **P L 4 Y E R**: replay stats, boost steals, bumps, tendencies.

**[Open the dashboard](https://thepl4yer.github.io/duoq-lab/)** · [Collected data (`data` branch)](https://github.com/thePl4yer/duoq-lab/tree/data)

## Where matches come from

| Source | Gives | You do |
| --- | --- | --- |
| Replay files | everything | **Folder** once; with Chrome's "Allow on every visit", new saved replays import whenever the page opens |
| Daily job | last 20 matches of PLAYER's account, analysed from Rocket League's own replays | one-time setup below |
| Live tab | result, goals, own-team speed and boost | keep the dashboard open while playing |

Everything shared is stored in `matches.json` on the [`data` branch](https://github.com/thePl4yer/duoq-lab/tree/data); the site reads it from there. Shared rows contain only the two players and the **day**, never the time.

## Daily job setup (once, about 5 minutes)

1. **Settings → Environments → New environment** named `collect`. Add a secret `LOGIN_KEY`: any 30+ random characters. Nobody needs to remember it.
2. **Actions → Collect matches → Run workflow**, choose `login: scout`. Open the link from the run log and confirm with a spare Epic account (a free throwaway).
3. Run it again with `login: player` and confirm with your own Epic account (the one linked to your Rocket League).

What it then does:

- Every 4 hours it renews both logins. This talks to Epic's login service only, never to the game.
- Around 06:00 Berlin time it asks Steam and (through the scout account) Rocket League whether PLAYER is online. If either says yes, or cannot answer, it does nothing until the next night. Otherwise it reads the last 20 matches, analyses the replays and commits the results.
- Rocket League keeps only the last 20 matches. On a longer day the earlier ones are covered by the live tab or saved replays.

Good to know:

- **Before setup** the job still runs and publishes the `data` branch from the existing matches. Only the match history part is off.
- **Remove it any time:** delete the `LOGIN_KEY` secret (the stored logins become unreadable). To be thorough, also use *sign out everywhere* in your Epic account.
- **Red ✗ on a run** means a login expired or `LOGIN_KEY` was changed: repeat step 2 or 3.
- Logs print counts only. The login link in the log is useless without your Epic password.
- The logins are stored encrypted on the `data` branch. The match history comes from an unofficial interface of the game; a game update can break it until [rlapi](https://github.com/dank/rlapi) catches up.
- Recommended: **Settings → Rules** on `main`, require a pull request with code-owner review. `.github/CODEOWNERS` already lists the files that can reach the secret.

## Live tab and sharing

Setup steps are on the dashboard under **Data & settings**. Sharing from a browser needs its key approved: copy the key shown there into `data/keys.json` as `{"<key>": "<name>"}`.

What each number means: hover it on the dashboard.

## v0.3 in short

- One-screen dashboard: no sidebar, top stats over the artwork, every comparison as a Kate / PLAYER row, definitions in tooltips.
- One MMR chart per mode with both players; click a mode in Ranks.
- Live capture reads the current game's message format.

## v0.2 in short

- Matches arrive on their own: nightly job, live tab, one-click folder sync.
- Data lives in this repository (`data` branch) instead of an external hosted database.
- Boost stolen now measures boost actually denied; added boost tax amounts, tendencies, Dropshot damage, ranks from match history.
- Removed the hosted backend and the Node logger (both still in tag `v0.1`).

## Develop

```sh
npm ci --ignore-scripts
npm test
npm run dev   # http://127.0.0.1:4173
```

| Path | Purpose |
| --- | --- |
| `src/app.js`, `src/ui.js` | dashboard UI, rows and charts ([DESIGN.md](DESIGN.md)) |
| `src/tracker.js` | Tracker snapshot helpers |
| `src/analysis.js` | summaries, merging, aggregation |
| `src/replay.js`, `src/boost.js` | replay → summary, steal analysis |
| `src/live.js` | local Stats API capture |
| `src/psynet.js` | Epic login and match history |
| `src/store.js` | shared dataset, signed relay records |
| `scripts/collect.mjs` | the scheduled job |

Replay parser: [subtr-actor](https://github.com/rlrml/subtr-actor) 1.5.1 (MIT). Fan project; Rocket League® belongs to its owners.

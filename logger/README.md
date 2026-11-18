# DuoQ Lab manual Rocket League logger

This logger runs only when you start it. It reads Rocket League's official local Game Data API, captures completed matches involving Kate and/or PLAYER, and sends compact results to the public DuoQ shared library.

**There is no Windows startup entry, scheduled task, installed service or background installation.** Close its console window or press Ctrl+C to stop it. The dashboard does not need to remain open; reload it to see newly published matches.

## Requirements

- Windows (the same Node scripts also run on macOS/Linux where the game API is available).
- [Node.js 24 or newer](https://nodejs.org/).
- Rocket League with the local Game Data API enabled.

No npm packages, Epic/Steam credentials, browser cookies or game-account tokens are needed.

## One-time API setup

1. Close Rocket League.
2. Locate its `TAGame/Config/TAStatsAPI.ini`, or `DefaultStatsAPI.ini` if that is the available configuration. The official documentation refers to the game's installation directory; some setups use the user configuration directory.
3. Run **Configure API.cmd** and paste that file's full path. This helper accepts only the named Stats API INI files inside `TAGame/Config`, preserves other settings and writes a backup beside an existing file. If Windows refuses access to the game directory, edit the same settings manually with your normal game-configuration workflow.
4. Start Rocket League again.

The settings written under the following section are:

```ini
[TAGame.MatchStatsExporter_TA]
PacketSendRate=10
Port=0
WebPort=49124
```

The setup helper does not start the logger and does not alter Windows startup settings. Rocket League must be restarted after changing its INI file.

## Every play session

1. Double-click **Start Logger.cmd**. Keep its visible console window open.
2. Play Rocket League. The logger waits if the game is not running, reconnects after a disconnect and publishes completed match results automatically.
3. Close the console or press Ctrl+C when you want logging to stop.

From a terminal you can instead run `node main.mjs`. From the repository root, use `npm run logger`.

For an inspection-only session, run `node main.mjs --dry-run` (or `npm run logger:dry-run` from the repository root). Dry run displays target-player summaries in the console without saving or uploading them.

## Exactly what it processes

- **Input:** JSON packets received from `ws://127.0.0.1:49124`, Rocket League's local Stats API. The logger never sends game commands.
- **Output:** completed match ID, UTC capture date, playlist, final team scores/winner and available goals, assists, saves, shots and demos for the two configured target IDs only.
- **Destination:** `https://duoq-lab-library-tk.fairy-cat-9312.chatgpt.site/api/replays`. Published summaries are public.
- **Local state:** this logger's `data/state.json` stores pending summaries and sent match IDs for retry/deduplication. Its `session.lock` prevents two normal sessions from sharing that queue. These files are ignored by Git and excluded from the download.
- **Other local reads:** the logger's own `logger.config.json`. The separate setup helper reads/writes only the Stats API file that you explicitly select.

It does not read replay files, game log files, game memory, other applications, browser profiles or account credentials. It does not monitor the keyboard, scan processes or search your disk. No raw socket feed, loadouts, arbitrary packet properties or other players' names/IDs are uploaded. The only process check is whether this logger's own previously recorded session PID is still alive, to recover a stale session lock.

Closing the logger stops collection. Pending completed summaries are retried only while a manually started logger is running. A match left before a confirmed winner is not counted as a loss or fabricated as a completed game.

## Identity and coverage

The default targets are:

- Kate: `Steam|76561198058377116|0`
- P L 4 Y E R: `Steam|76561198060138310|0`

Identity uses platform IDs, never display-name matching. If your game reports an Epic primary ID instead, add the known public ID to `logger.config.json`:

```json
{"aliases":{"Epic|YOUR_32_CHARACTER_PUBLIC_EPIC_ID|0":"76561198060138310"}}
```

This is a public player identifier, not a password or access token. Unknown identities are skipped. Kate needs her own manually running logger for her separate games. Shared matches captured by both loggers are deduplicated by Match GUID.

Start before entering a match for complete roster coverage. If the logger joins mid-match, it may capture the confirmed result and scoreboard but cannot prove that an unseen target player was absent earlier. Such one-player records count in Overall but are excluded from Solo. Seeing both target players provides direct Together/Against evidence.

Replay playback is excluded. A loaded history replay is blocked by its `ReplayCreated` event. Goal-replay scoreboard updates may finish an already observed live match; they never start a new capture.

## Statistics that remain unavailable

Normal live-player API access does not guarantee movement or boost data. The logger deliberately stores speed, tracked playtime, boost, supersonic/air time, bumps and boost tax as **unknown**, never as invented zeroes. The dashboard excludes these matches from those metric denominators. If the API connection closes before a final scoreboard arrives, the confirmed winner is kept, but the score and counters are marked as last observed (an asterisk appears beside the score). A later real replay can upgrade the same match without adding another game.

The bundled Node scripts are covered by automated packet, persistence and API-integration checks. Game updates can change the live feed; check the console and verify your first real match in the dashboard.

Source: [official Rocket League Stats API documentation](https://www.rocketleague.com/developer/stats-api).

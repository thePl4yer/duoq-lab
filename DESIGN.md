# Design

One screen that reads like a scoreboard: the numbers that matter first, detail on demand.

## Direction

- **Reference:** Rocket League's own in-game scoreboard and HUD: dark field, condensed italic numerals, team colours carry identity.
- **Density:** a data analyser, not a landing page. Every card is a compact table; no prose on the page.
- **Tone:** the anime hero stays as a backdrop with the top stats painted over it. Jokes live in tooltips, not in the layout.

## Colour

Sampled from the hero art.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0c1119` | page (midnight cobalt) |
| `--card` | `#131a25` | cards |
| `--line` | `#243041` | borders, grid lines |
| `--text` / `--muted` | `#e8edf3` / `#8794a6` | text |
| `--kate` | `#c3b6db` | Kate: grey-lavender hair |
| `--player` | `#e8be5c` | PLAYER: gold trim |
| `--accent` | `#6fb6ff` | interaction only (focus, active tab, links): arena lights |

Player colours mean a player and nothing else. The accent is never a player.

## Type

- **Saira**, one variable family: 800 italic at 75% width for numbers and titles (scoreboard feel, condensed so more fits), 500 at 87.5% width for text. Tabular numerals everywhere.
- Scale: 11 / 12 / 14 / 20 / 28 px and a fluid hero size. Nothing under 11px.

## Layout

- No sidebar. Hero band (art + title + tools + four big stats), one filter bar, then a card grid: `repeat(auto-fill, minmax(300px,1fr))`, dense packing. Phone: two columns.
- Matches and Data & settings are inline accordions below the grid. Frequent actions (add files, live, history) sit in the hero, never in a dialog.
- Dialogs only for detail: one match, bump events, boost tax events, About the data.

## Components

- **Pair row:** label · Kate value · PLAYER value, with a 2px split bar underneath. Every comparison uses it. Empty on both sides: the row is not shown.
- **Line chart:** one SVG per metric with both players on shared axes, real pixel size (text never scales), hover readout, latest data at the right edge.
- **Tooltip:** `data-tip` on hover and focus. Definitions live there, not in paragraphs and not in the README.

## Rules

- Say a thing once. Player names appear in the legend; elsewhere colour identifies them.
- Each card has one icon and one word as its title.
- Radius 6px for cards, 4px for controls. No glow, no gradient text.
- Keyboard focus is always visible. Motion is limited to number count-up and honours `prefers-reduced-motion`.

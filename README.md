# Wheels Up Collective — League HQ

Clubhouse site for the **Wheels Up Collective**, a 14-team IDP league on [Fantrax](https://www.fantrax.com/fantasy/league/hms8onqvmsb3ulsx/home).

It is a static site: plain HTML, CSS, and JavaScript. No build step. GitHub Pages serves the `main` branch at <https://wjenson27-cpu.github.io/wheels-up-league-hq/>.

**Bill’s team:** Eagle Ridge Eddies  
**Draft:** Aug 30, 2026  
**Commissioner:** Luke Sahlberg (ThiccSwede)

## Look at it on your computer

Pages load their numbers from `data/*.json`, so opening a file directly (`file://`) will look empty. Use a tiny local server:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Pages

| Page | What it shows |
|------|----------------|
| `index.html` | Home. Current week scores, a standings snapshot, and the trade count board. |
| `standings.html` | Full standings (including playoff odds), points-for chart, and each week’s head-to-head scores. |
| `team.html?id=eddies` | One club: record, weekly scores, roster, settled FAAB, completed trades, transactions. Every team id works the same way. |
| `rosters.html` | All 14 clubs. Open a card for the depth chart. Names link to the team page. |
| `trades.html` | Completed trades, plus who is on the trade block. Pending offers are not shown. |
| `faab.html` | Budgets, settled claims of $1 or more, and FAAB that moved in completed trades. |
| `rankings.html` | Power rankings and blurbs. Team names link to team pages. |
| `awards.html` | Weekly kitty, Survivor, Last Ride, and season award trackers. |
| `recap.html` | Written week recaps. |
| `history.html` | League history summary. |
| `archives.html` | 2014–2025 trophy book. This page keeps its own layout. |
| `podcast.html` | Spotify show. |
| `scoring.html` | Scoring cheat sheet. Official rules stay on Fantrax. |
| `td-parlay.html` | TD parlay grid. |

## Data files

Automated jobs write these files and push them to `main` several times a day. **Do not rename them, move them, or change their keys.** The site reads whatever shape is already there. New numbers are calculated in the browser.

| File | What it is |
|------|------------|
| `data/teams.json` | 14 clubs: names, owners, records, points, FAAB, colors. |
| `data/scores.json` | Latest week’s matchups. |
| `data/scores-wN-2026.json` | Older weeks, when those files exist (`scores-w1-2026.json`, and so on). |
| `data/schedule.json` | Season matchup pairings. The playoff sim reads `weeks`. |
| `data/rosters/*.json` | Depth chart for each club. |
| `data/roster-eddies.json` | Older Eddies roster file. Used only if `data/rosters/eddies.json` is missing. |
| `data/transactions.json` | League wire. |
| `data/trades.json` | Completed trades and trade-block lists. The site ignores `pending`. |
| `data/faab.json` | Balances and settled claims. Pending bids are not shown. |
| `data/rankings.json` | Power rankings. |
| `data/awards.json` | Kitty, Survivor, Last Ride, yearly awards. |
| `data/recaps.json` | Week recap writeups. |
| `data/history.json` | History page source. |
| `data/td-parlay.json` | Parlay grid. |
| `data/espn-seasons.json` | Older ESPN seasons used by history. |

`data/schedule-scratch.json` and `data/scores-scratch.json` are already in the repo. Leave them. New files whose names contain `PREVIEW`, or files named `*.DRAFT.json`, are ignored by git.

## Shared code

- `css/styles.css` — dark green-and-navy theme
- `js/config.js` — league name, Fantrax link, season, podcast URL
- `js/main.js` — header, footer, menu
- `js/league.js` — standings, team pages, score charts, playoff odds, and the “settled only” filters

Playoff % on the standings page is calculated in the browser (10,000 simulated seasons). It assumes an **8-team playoff** and a **14-week regular season**, with no divisions and no byes. That comes from the 2024–2025 notes in `data/history.json` (2024 says “8-team playoffs”; 2025’s champion was a 5-seed and the 1-seed played in round 1; records such as 12-2 and 11-3 are 14 games). The constant is `PLAYOFF_ODDS` at the top of `js/league.js` if those rules change. The same scores and schedule always produce the same percentages.

The sim reads **`data/schedule.json` → `weeks`**, the same list weeks 1–5 already use. Each key is the week number as a string. Each value is an array of games, and each game is two club names:

```json
"weeks": {
  "6": [
    ["Eagle Ridge Eddies", "Mrs. Doubtpfizer"],
    ["Pocket Agents", "Ultron"]
  ]
}
```

Use the club’s `name` from `teams.json` (for example `Towner Top Aga Bottom`, not `TTAB`). When a data job adds weeks 6–14 in that shape, those real matchups are used automatically. A week that is missing from `weeks` is still simulated, but the pairing is random. The per-team arrays elsewhere in the file are not what the sim reads.

Podcast link, if it ever changes:

```js
PODCAST_URL: "https://open.spotify.com/show/7q7HcYt7hu5P4jXEcceyUk"
```

## Check before you merge

```bash
node scripts/check-site.mjs --json
```

That confirms every `data/**/*.json` file parses. To also open each page in Chrome (no red errors in the console):

```bash
npm install --no-save puppeteer-core
node scripts/check-site.mjs --pages
```

GitHub runs the JSON check on every push to `main`, including the automatic data updates. The browser check runs on pull requests. A failed check does not block those data pushes; it only reports the problem.

## What stays off the public site

Pending FAAB bids and pending trade offers are not shown. Only settled claims and completed trades.

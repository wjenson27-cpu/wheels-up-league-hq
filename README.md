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
| `matchups.html` | Live matchups for the current week: score, projection, players still to play, and a win-chance bar. |
| `standings.html` | Full standings (including playoff odds), points-for chart, and each week’s head-to-head scores. |
| `team.html?id=eddies` | One club: record, weekly scores, all-time head-to-head (Fantrax era), roster, settled FAAB, completed trades, transactions. Every team id works the same way. |
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
| `data/teams.json` | 14 clubs: names, owners, colors, logos. The site does not use `powerRank`, `standingsRank`, `record`, or points from this file. |
| `data/scores.json` | Latest week’s matchups. |
| `data/matchups-live.json` | Live matchups page. Built by `scripts/build-matchups-live.mjs`. Do not hand-edit; rebuild it. |
| `data/livescoring-wN.json` | Fantrax live-scoring read for week N. Preferred input for the live page. |
| `data/matchups-live.overlay.json` | Optional live totals used only where the live-scoring file has a hole. |
| `data/scores-wN-2026.json` | Older weeks, when those files exist (`scores-w1-2026.json`, and so on). |
| `data/schedule.json` | Season matchup pairings. The playoff sim reads `weeks`. |
| `data/rosters/*.json` | Depth chart for each club. |
| `data/roster-eddies.json` | Older Eddies roster file. Used only if `data/rosters/eddies.json` is missing. |
| `data/transactions.json` | League wire. |
| `data/trades.json` | Completed trades and trade-block lists. The site ignores `pending`. |
| `data/faab.json` | Balances and settled claims. Pending bids are not shown. |
| `data/rankings.json` | Power rankings. A file or row with `pendingPublish: true` is hidden. |
| `data/awards.json` | Kitty, Survivor, Last Ride, yearly awards. |
| `data/recaps.json` | Week recap writeups. |
| `data/history.json` | History page source. |
| `data/td-parlay.json` | Parlay grid. |
| `data/espn-seasons.json` | Older ESPN seasons used by history. |
| `data/h2h-history.json` | 2024–2025 Fantrax head-to-head games for the team-page all-time table. Written by hand, not by a data job. |

`data/schedule-scratch.json` and `data/scores-scratch.json` are already in the repo. Leave them. New files whose names contain `PREVIEW`, or files named `*.DRAFT.json`, are ignored by git.

### `data/h2h-history.json`

The 2024 and 2025 Fantrax games behind the team-page table **All-time vs. each team**. Each game has these fields:

```json
{ "season": 2025, "week": 15, "round": "playoff", "bracket": "Playoffs R1",
  "teamA": "eddies", "nameA": "Eagle Ridge Eddies", "scoreA": 408,
  "teamB": "saltese", "nameB": "Saltese Slamm", "scoreB": 181 }
```

- `teamA` and `teamB` are current `teams.json` ids. History follows the **owner**, so an old team name counts under the current club only when the same owner ran it (Agatron → Ultron, Otis Orchards IT Dept → SPD’s, Riverbend Overbois and Abuse of Power → Substation; Riverbend’s co-manager Vikingdan68 is ignored).
- An owner who has left the league keeps his own id, listed in `pastOwners`. `sak` is Mike Sakurada’s We Will Sak You (2024–25); `successor` names the club that took the spot (`hyper`, from 2026). It shows as its own row on every team page and does not roll into The Hypersecretors, who start in 2026.
- `nameA` and `nameB` are the names used in that season.
- `round` is `regular` or `playoff` (winners bracket, including the 2025 3rd/4th game).
- Consolation games are not in the file. `excludedConsolationGames` gives the count per season.
- `formerNames` lists the old names by current club, and the footnote is built from it with `pastOwners`.
- 2026 is not stored here. The table reads 2026 from the posted final score files (weeks 1–14), so it updates every week. A 2026 game after week 14 counts only if its score row is tagged as a winners-bracket playoff game.

### `data/matchups-live.json`

The Live Matchups page reads this file and nothing else for the slate. Rebuild it after the sync drops new scores or an overlay:

```bash
node scripts/build-matchups-live.mjs
```

The builder takes pairings from `data/schedule.json` → `weeks`. If `data/scores.json` is still a finished week, the live slate is the next scheduled week. A same-week `scores.json` fills score, and any projection or players-left fields on those games. `data/livescoring-wN.json` is preferred over that and over the overlay: each matchup is a pair of club rows with `score`, `proj`, `done`, `inProgress`, `yet`, and `min`. `yet` is the players-still-to-play count the win formula uses. `data/matchups-live.overlay.json` fills only holes the live-scoring file left. A roster file can add `playersLeft` (an integer from 0 to 14) or per-player `played` / `yetToPlay` flags when no live-scoring row covers that club. A depth chart of plain names does not invent a headcount. Pass `--raw` with a Fantrax scrape that has `week8_header` to fill the same holes from that widget.

A row with projection 0 and nobody done, in progress, or yet to play is an unset lineup. The page says "No lineup set" and the win bar stays inside the live 5–95% cap instead of calling it a lock.

Missing score, projection, or players-left stays `null`. The page shows a dash. Null is not stored as zero.

`asOf` is the Pacific clock time the live numbers were observed, and it ends with `PT`. The page prints `as of <asOf>`.

Win chance is `formula.id` `normal-approx-v1`, calculated in `js/live-prob.js` (the page and the builder share that file). It is a normal approximation, rounded to the nearest 5%. A game still going stays between 5% and 95%. A finished game is 100 / 0, or 50 / 50 on a tie. If either projection is missing, `winProb` is `null` and the bar is blank. Each starter still out is an 8-point standard deviation. When the headcount is missing, a club with projected points still out uses an 18-point stand-in, and the card says so.

The Eddies vs Ultron game is `featured` and listed first. The public name for Towner Top Aga Bottom is `TTAB`. Do not put owner names, bids, claims, or trades in this file or the overlay.

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

Power rank (the pill that says `Power #3 (Wk 5)`) comes from `data/rankings.json`: the `rankings` array, matched on `teamId`, and the file’s `week`. If the file or that row has `pendingPublish: true`, or the club is not in the array, the pill is hidden. `teams.json` `powerRank` is never shown.

Standings rank, win-loss record, and points on the home page, standings, team pages, the power rankings record badge, and roster cards are added up from posted final scores (`data/scores.json` and `data/scores-wN-2026.json`). Order is wins, then losses, then ties, then points for. FAAB left comes from `data/faab.json` `teamBalances`. Awards and history keep their own files.

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

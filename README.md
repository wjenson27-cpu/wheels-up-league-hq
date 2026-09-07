# Wheels Up Collective — League HQ

Static clubhouse site for the **Wheels Up Collective** (14-team IDP on [Fantrax](https://www.fantrax.com/fantasy/league/hms8onqvmsb3ulsx/home)). Dark sports-editorial UI, mobile-friendly, vanilla HTML/CSS/JS.

**Bill’s team:** Eagle Ridge Eddies  
**Draft:** Aug 30, 2026  
**Commissioners:** Larry Salisbury / Luke Sahlberg (ThiccSwede)

## Quick start

Open any page in a browser. Because pages fetch `data/*.json`, use a tiny local server (file:// often blocks fetch):

```bash
cd /workspace/wheels-up-league-hq
python3 -m http.server 8080
# then visit http://localhost:8080
```

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home pulse — CTA, tx snippet, Eddies snapshot |
| `smack.html` | Smack talk board (`localStorage`) |
| `rosters.html` | Team cards + Eddies depth chart + tx feed |
| `trades.html` | Trade scoreboard (empty + sample placeholder) |
| `rankings.html` | Week 1 power rankings 1–14 |
| `history.html` | League history placeholders |
| `podcast.html` | Big CTA + Spotify embed |
| `scoring.html` | Rules / About + Fantrax link |

## Edit data (`data/*.json`)

| File | What to change |
|------|----------------|
| `data/teams.json` | All 14 team names, owners, FAAB, notes |
| `data/roster-eddies.json` | Eagle Ridge Eddies roster by position |
| `data/transactions.json` | Add/drop / FAAB feed |
| `data/rankings.json` | Weekly power rankings + blurbs |
| `data/trades.json` | Real trades (and optional UI samples) |
| `data/history.json` | Champions, lore, commissioner eras |

Other teams’ names/blurbs in rankings are **SAMPLE** until you replace them with real Fantrax data.

## Podcast URL

Set in `js/config.js`:

```js
PODCAST_URL: "https://open.spotify.com/show/7q7HcYt7hu5P4jXEcceyUk",
podcastUrl: "https://open.spotify.com/show/7q7HcYt7hu5P4jXEcceyUk",
```

`podcast.html` builds the Spotify embed from that show URL. Change either field and reload.

## Smack talk = demo only

Posts on `smack.html` are stored in the browser via **`localStorage`**. Each device/browser has its own board. Fine for a local demo; **production needs a backend** (or hosted comments) if the whole league should see the same trash talk.

## Shared assets

- `css/styles.css` — dark sports-editorial theme  
- `js/config.js` — league constants + `PODCAST_URL`  
- `js/main.js` — nav, footer, JSON helpers, Spotify embed helper  
- `js/smack.js` — smack board logic  

## Fantrax

League home: https://www.fantrax.com/fantasy/league/hms8onqvmsb3ulsx/home


## Sharing (league members)

**Current:** static site on the shared box at `/workspace/wheels-up-league-hq/` (includes `archives.html`).

**To go public (pick one):**
1. **GitHub Pages / Netlify / Cloudflare Pages** — push this folder; set `archives.html` + `index.html` as site root. Fastest once Origin/git host is ready.
2. **Fantrax message / Discord** — paste the public URL after host.
3. **Blocker today:** no public URL yet (Origin namespace not set up; box paths are not internet-reachable).

Internal nav: History page → full Archives. Archives header → back to League HQ.

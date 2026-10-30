#!/usr/bin/env node
/**
 * Lightweight site check.
 *   node scripts/check-site.mjs          JSON + static files
 *   node scripts/check-site.mjs --pages  also open every page in Chrome
 *
 * Page console failures ignore third-party noise (Cloudflare analytics,
 * the visit counter, Spotify, Google fonts).
 */
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FORMULA, winProbability } from "../js/live-prob.js";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const args = new Set(process.argv.slice(2));
const jsonOnly = args.has("--json");
const pagesOnly = args.has("--pages");
const runJson = !pagesOnly || args.has("--json") || args.size === 0;
const runPages = args.has("--pages");

const PAGES = [
  ["index.html", "/index.html"],
  ["matchups.html", "/matchups.html"],
  ["standings.html", "/standings.html"],
  ["team.html", "/team.html"],
  ["team-eddies", "/team.html?id=eddies"],
  ["team-unknown", "/team.html?id=not-a-club"],
  ["rosters.html", "/rosters.html"],
  ["trades.html", "/trades.html"],
  ["rankings.html", "/rankings.html"],
  ["recap.html", "/recap.html"],
  ["awards.html", "/awards.html"],
  ["faab.html", "/faab.html"],
  ["td-parlay.html", "/td-parlay.html"],
  ["history.html", "/history.html"],
  ["archives.html", "/archives.html"],
  ["podcast.html", "/podcast.html"],
  ["scoring.html", "/scoring.html"]
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];

const failures = [];

function fail(msg) {
  failures.push(msg);
  console.error("FAIL", msg);
}

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function checkJson() {
  const dataDir = join(root, "data");
  const files = (await walk(dataDir)).filter((f) => f.endsWith(".json"));
  if (!files.length) fail("no JSON files under data/");
  for (const file of files) {
    const rel = relative(root, file);
    let text = "";
    try {
      text = await readFile(file, "utf8");
      JSON.parse(text);
    } catch (err) {
      fail(`[site] ${rel} is not valid JSON (${err.message})`);
      continue;
    }
    if (!text.trim()) fail(`${rel} is empty`);
  }
  console.log(`JSON ok (${files.length} files)`);

  const required = [
    "index.html", "matchups.html", "standings.html", "team.html", "rosters.html", "trades.html",
    "rankings.html", "recap.html", "awards.html", "faab.html", "td-parlay.html",
    "history.html", "archives.html", "podcast.html", "scoring.html",
    "css/styles.css", "js/main.js", "js/config.js", "js/league.js",
    "js/live-prob.js", "js/matchups-page.js", "scripts/build-matchups-live.mjs",
    "data/matchups-live.json"
  ];
  for (const rel of required) {
    try {
      const info = await stat(join(root, rel));
      if (!info.isFile()) fail(`${rel} is not a file`);
    } catch {
      fail(`missing ${rel}`);
    }
  }

  const shared = required.filter((f) => f.endsWith(".html") && f !== "archives.html");
  for (const rel of shared) {
    const html = await readFile(join(root, rel), "utf8");
    if (!html.includes("css/styles.css")) fail(`${rel} does not load css/styles.css`);
    if (!html.includes("js/main.js")) fail(`${rel} does not load js/main.js`);
    if (!html.includes('rel="icon"') && !html.includes("rel='icon'")) fail(`${rel} has no favicon`);
  }
  const leaguePages = ["index.html", "matchups.html", "standings.html", "team.html", "rosters.html", "trades.html", "faab.html"];
  for (const rel of leaguePages) {
    const html = await readFile(join(root, rel), "utf8");
    if (!html.includes("js/league.js")) fail(`${rel} does not load js/league.js`);
  }
  const trades = await readFile(join(root, "trades.html"), "utf8");
  if (trades.includes("tradePending") || /Pending offers/i.test(trades)) {
    fail("trades.html still has a pending-offers section");
  }
  await checkMatchupsLive();
}

const LIVE_BANNED_KEYS = new Set(["owner", "owners", "pending", "pendingclaim", "pendingclaims", "bid", "bids", "claim", "claims", "trade", "trades"]);

function nowForChecks() {
  const envNow = process.env.CHECK_SITE_NOW ? Date.parse(process.env.CHECK_SITE_NOW) : NaN;
  return Number.isNaN(envNow) ? Date.now() : envNow;
}

function ptYmd(utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(utcMs));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function addUtcDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/* Same Thursday-start rule as data/scoring.json. Week 8 is Oct 29 – Nov 4, 2026. */
function liveWeekNumber(utcMs) {
  const today = ptYmd(utcMs);
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse("2026-09-10T00:00:00Z")) / 86400000);
  return 1 + Math.floor(days / 7);
}

function walkBannedKeys(value, path, hits) {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (LIVE_BANNED_KEYS.has(String(key).toLowerCase())) hits.push(`${path}.${key}`);
    walkBannedKeys(value[key], `${path}.${key}`, hits);
  }
}

async function checkMatchupsLive() {
  const rel = "data/matchups-live.json";
  const data = await loadJson(root, rel, "[site] ");
  if (!data) return;
  const teams = await loadJson(root, "data/teams.json", "[site] ");
  const owners = ((teams && teams.teams) || []).map((t) => t && t.owner).filter(Boolean);
  const blob = JSON.stringify(data);
  for (const name of owners) {
    if (blob.includes(name)) fail(`${rel} names an owner (${name})`);
  }
  if (/Towner Top Aga Bottom/.test(blob)) fail(`${rel} uses the long TTAB name`);
  if (/\b(pending|bids?|claims?)\b/i.test(blob)) fail(`${rel} mentions a bid, claim, or pending item`);
  const badKeys = [];
  walkBannedKeys(data, "$", badKeys);
  if (badKeys.length) fail(`${rel} has banned keys: ${badKeys.join(", ")}`);
  if (data.schemaVersion !== 1) fail(`${rel} schemaVersion is ${data.schemaVersion}`);
  const expectedWeek = liveWeekNumber(nowForChecks());
  if (Number(data.week) !== expectedWeek) fail(`${rel} week is ${data.week}, expected ${expectedWeek}`);
  const windowStart = addUtcDays("2026-09-10", (expectedWeek - 1) * 7);
  const windowEnd = addUtcDays(windowStart, 6);
  if (data.weekStart !== windowStart || data.weekEnd !== windowEnd) {
    fail(`${rel} window is ${data.weekStart} – ${data.weekEnd}, expected ${windowStart} – ${windowEnd}`);
  }
  if (expectedWeek === 8 && (data.weekStart !== "2026-10-29" || data.weekEnd !== "2026-11-04")) {
    fail(`${rel} Week 8 window is not Oct 29 – Nov 4, 2026`);
  }
  if (data.timezone !== "PT") fail(`${rel} timezone is not PT`);
  if (!parseTimed(data.asOf)) fail(`${rel} asOf "${data.asOf}" is not a Pacific timestamp`);
  if (!String(data.asOf || "").trim().endsWith("PT")) fail(`${rel} asOf does not end with PT`);
  const formula = data.formula || {};
  if (formula.id !== FORMULA.id) fail(`${rel} formula id ${formula.id}`);
  if (formula.playerSd !== FORMULA.playerSd || formula.unknownTeamSd !== FORMULA.unknownTeamSd) {
    fail(`${rel} formula constants do not match js/live-prob.js`);
  }
  if (formula.text !== FORMULA.text) fail(`${rel} formula text does not match js/live-prob.js`);
  const games = data.matchups;
  if (!Array.isArray(games) || games.length !== 7) fail(`${rel} has ${games && games.length} matchups, expected 7`);
  else {
    const first = games[0];
    const ids = first && [first.sideA && first.sideA.teamId, first.sideB && first.sideB.teamId];
    if (expectedWeek === 8) {
      if (!first || first.featured !== true || !ids.includes("eddies") || !ids.includes("ultron")) {
        fail(`${rel} does not feature Eddies vs Ultron first`);
      }
      if (first && first.sideA && first.sideA.name !== "Eagle Ridge Eddies") fail(`${rel} featured side A is ${first.sideA && first.sideA.name}`);
      if (first && first.sideB && first.sideB.name !== "Ultron") fail(`${rel} featured side B is ${first.sideB && first.sideB.name}`);
    } else if (games.some((g) => g.featured) && (!first || first.featured !== true)) {
      fail(`${rel} featured matchup is not first`);
    }
    const ttab = JSON.stringify(games).match(/"teamId":"ttab"[^}]*"name":"([^"]*)"/);
    const ttabSide = games.flatMap((g) => [g.sideA, g.sideB]).find((s) => s && s.teamId === "ttab");
    if (!ttabSide || ttabSide.name !== "TTAB") fail(`${rel} TTAB public name is ${ttabSide && ttabSide.name}`);
    if (ttab && ttab[1] !== "TTAB") fail(`${rel} TTAB name mismatch`);
    if (expectedWeek === 8) {
      if (data.asOf !== "2026-10-30 9:17 AM PT") fail(`${rel} asOf is "${data.asOf}", expected 2026-10-30 9:17 AM PT`);
      if (!(data.sources || []).includes("data/livescoring-w8.json")) fail(`${rel} was not built from data/livescoring-w8.json`);
      if (ttabSide && ttabSide.lineupSet !== false) fail(`${rel} TTAB lineup is not marked unset`);
      const live = await loadJson(root, "data/livescoring-w8.json", "[site] ");
      const byName = new Map();
      for (const game of games) {
        for (const side of [game.sideA, game.sideB]) {
          if (side) byName.set(side.teamId === "ttab" ? "Towner Top Aga Bottom" : side.name, { side, game });
        }
      }
      for (const pair of (live && live.matchups) || []) {
        if (!Array.isArray(pair)) continue;
        for (const row of pair) {
          const found = byName.get(row.team);
          if (!found) {
            fail(`${rel} missing live row for ${row.team}`);
            continue;
          }
          if (found.side.score !== row.score) fail(`${rel} ${row.team} score ${found.side.score} != ${row.score}`);
          if (found.side.projection !== row.proj) fail(`${rel} ${row.team} projection ${found.side.projection} != ${row.proj}`);
          if (found.side.playersLeft !== row.yet) fail(`${rel} ${row.team} players left ${found.side.playersLeft} != yet ${row.yet}`);
        }
      }
      const morningside = byName.get("Morningside Muff Divers");
      if (morningside) {
        const pct = morningside.game.sideA.teamId === "morningside" ? morningside.game.winProb.sideA : morningside.game.winProb.sideB;
        if (pct !== 0.95) fail(`${rel} Morningside win chance is ${pct}, expected 0.95`);
      } else fail(`${rel} missing Morningside`);
      if (games.some((g) => !g.winProb)) fail(`${rel} a Week 8 game has no win bar`);
    }
    for (const game of games) {
      for (const side of [game.sideA, game.sideB]) {
        if (!side) {
          fail(`${rel} matchup ${game.id} is missing a side`);
          continue;
        }
        for (const key of ["score", "projection", "playersLeft"]) {
          const value = side[key];
          if (value == null) continue;
          if (typeof value !== "number" || !Number.isFinite(value)) fail(`${rel} ${game.id} ${side.teamId} ${key} is not a number`);
        }
        if (side.playersLeft != null && (!Number.isInteger(side.playersLeft) || side.playersLeft < 0 || side.playersLeft > 14)) {
          fail(`${rel} ${game.id} ${side.teamId} playersLeft is ${side.playersLeft}`);
        }
      }
      const expect = winProbability({
        scoreA: game.sideA && game.sideA.score,
        projA: game.sideA && game.sideA.projection,
        leftA: game.sideA && game.sideA.playersLeft,
        scoreB: game.sideB && game.sideB.score,
        projB: game.sideB && game.sideB.projection,
        leftB: game.sideB && game.sideB.playersLeft,
        emptyA: game.sideA && game.sideA.lineupSet === false,
        emptyB: game.sideB && game.sideB.lineupSet === false,
        final: game.status === "final"
      });
      const got = game.winProb;
      if (expect == null && got != null) fail(`${rel} ${game.id} has a winProb the formula would leave blank`);
      if (expect != null && (!got || got.sideA !== expect.sideA || got.sideB !== expect.sideB || got.decided !== expect.decided)) {
        fail(`${rel} ${game.id} winProb ${JSON.stringify(got)} != ${JSON.stringify(expect)}`);
      }
      if (got && got.decided !== true) {
        const pct = Math.round(got.sideA * 100);
        if (pct % 5 !== 0 || pct < 5 || pct > 95) fail(`${rel} ${game.id} live win chance ${pct}% is off the 5% band`);
      }
    }
  }
  const page = await readFile(join(root, "matchups.html"), "utf8");
  if (!page.includes('type="module" src="js/matchups-page.js"') && !page.includes("js/matchups-page.js")) {
    fail("matchups.html does not load js/matchups-page.js");
  }
  console.log("Live matchups JSON ok");
}

// ---- Data integrity: rosters must have players, sync data must be fresh ----
const MAX_AGE_MS = 36 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 2 * 60 * 60 * 1000;
// Freshness applies ONLY to roster/transaction sync output. Recaps, awards,
// power rankings, scores, schedule and teams.json (standings + power ranks,
// edited by recap/rankings pushes) are deliberately exempt so a missed scrape
// never blocks those pushes.
const FRESH_FILES = ["data/transactions.json", "data/trades.json", "data/faab.json", "data/roster-eddies.json"];
// Mirror tree (sibling ../wheels-up-league-hq, i.e. /workspace/wheels-up-league-hq
// for this repo) is EXPECTED: missing folder or checked files that differ from
// the site fail. Same JSON/roster/freshness rules apply. Override with
// CHECK_SITE_MIRROR=/path, or CHECK_SITE_MIRROR=none to skip.
const MIRROR_ROOT = process.env.CHECK_SITE_MIRROR ?? join(root, "..", "wheels-up-league-hq");
const TS_FIELDS = ["lastSynced", "asOf", "updated"];
// lastSynced: timed heartbeat ("2026-10-20 4:40 PM PT") stamped by the sync on
// every run, even when nothing changed. When present it alone decides staleness;
// asOf/updated are then only parsed and future-checked.

// Offset (minutes) of America/Los_Angeles from UTC at a given UTC instant.
function ptOffsetMinutes(utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - utcMs) / 60000;
}

// Wall-clock time in PT -> UTC ms (DST-aware).
function ptToUtc(y, mo, d, h, mi, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = guess - ptOffsetMinutes(guess) * 60000;
  ms = guess - ptOffsetMinutes(ms) * 60000;
  return ms;
}

// Returns {start, end} UTC ms, or null if unparseable. Formats seen in data/:
//   "2026-10-20 4:40 PM PT" (also PDT/PST, 24h "16:40 PT")  -> start = end
//   "2026-10-20" (date only)  -> start 00:00 PT (future check), end 23:59:59 PT (staleness)
//   ISO strings with Z or an explicit offset.
function parseDataTimestamp(value) {
  const v = typeof value === "string" ? value.trim() : "";
  const d = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d) return { start: ptToUtc(+d[1], +d[2], +d[3], 0, 0, 0), end: ptToUtc(+d[1], +d[2], +d[3], 23, 59, 59), dateOnly: true };
  const ms = parseTimed(value);
  return ms === null ? null : { start: ms, end: ms, dateOnly: false };
}

function parseTimed(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*(PT|PDT|PST)$/i);
  if (m) {
    let h = +m[4];
    const ap = (m[7] || "").toUpperCase();
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === "AM" && h === 12) h = 0;
      if (ap === "PM" && h !== 12) h += 12;
    }
    if (h > 23) return null;
    return ptToUtc(+m[1], +m[2], +m[3], h, +m[5], +(m[6] || 0));
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function countPlayers(data) {
  if (!data || typeof data !== "object" || !data.roster || typeof data.roster !== "object") return 0;
  return Object.values(data.roster)
    .filter(Array.isArray)
    .reduce((n, arr) => n + arr.filter((p) => typeof p === "string" ? p.trim() : p).length, 0);
}

async function loadJson(base, rel, tag) {
  let text;
  try {
    text = await readFile(join(base, rel), "utf8");
  } catch (err) {
    fail(`${tag}${rel} could not be read (${err.code || err.message})`);
    return undefined;
  }
  if (!text.trim()) {
    fail(`${tag}${rel} is empty`);
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`${tag}${rel} is not valid JSON (${err.message})`);
    return undefined;
  }
}

async function checkDataIntegrity(base, label) {
  const tag = `[${label}] `;
  const envNow = process.env.CHECK_SITE_NOW ? Date.parse(process.env.CHECK_SITE_NOW) : NaN;
  const now = Number.isNaN(envNow) ? Date.now() : envNow;
  let rosterFiles = [];
  try {
    rosterFiles = (await readdir(join(base, "data/rosters")))
      .filter((f) => f.endsWith(".json")).sort().map((f) => `data/rosters/${f}`);
  } catch {
    fail(`${tag}data/rosters/ is missing`);
  }
  const playerFiles = [...rosterFiles.filter((f) => f !== "data/rosters/index.json"), "data/roster-eddies.json"];
  const freshFiles = [...new Set([...FRESH_FILES, ...rosterFiles])];
  const cache = new Map();
  const get = async (rel) => {
    if (!cache.has(rel)) cache.set(rel, await loadJson(base, rel, tag));
    return cache.get(rel);
  };
  let rosterOk = 0;
  for (const rel of playerFiles) {
    const data = await get(rel);
    if (data === undefined) continue;
    const n = countPlayers(data);
    if (n === 0) fail(`${tag}${rel} has zero players (roster position arrays are empty or missing)`);
    else rosterOk++;
  }
  // index.json must list teams, and every listed team needs a roster file.
  const index = rosterFiles.includes("data/rosters/index.json") ? await get("data/rosters/index.json") : undefined;
  if (index && (!Array.isArray(index.teams) || !index.teams.length)) fail(`${tag}data/rosters/index.json lists no teams`);
  else if (index) {
    for (const id of index.teams) {
      if (!rosterFiles.includes(`data/rosters/${id}.json`)) fail(`${tag}data/rosters/index.json lists ${id} but data/rosters/${id}.json is missing`);
    }
  }
  let freshOk = 0;
  for (const rel of freshFiles) {
    const data = await get(rel);
    if (data === undefined) continue;
    const present = TS_FIELDS.filter((k) => data && data[k] !== undefined);
    if (!present.length) {
      fail(`${tag}${rel} has no lastSynced/asOf/updated timestamp`);
      continue;
    }
    let good = true;
    const parsed = {};
    for (const k of present) {
      const t = parseDataTimestamp(data[k]);
      if (t === null || (k === "lastSynced" && t.dateOnly)) {
        fail(`${tag}${rel} ${k} "${data[k]}" is not a recognized ${k === "lastSynced" ? "timed " : ""}timestamp`);
        good = false;
        continue;
      }
      parsed[k] = t;
      if (t.start - now > MAX_FUTURE_MS) {
        const hrs = ((t.start - now) / 3600000).toFixed(1);
        fail(`${tag}${rel} ${k} "${data[k]}" is ${hrs}h in the future (limit 2h)`);
        good = false;
      }
    }
    // Roster files restamp a timed asOf on every rebuild, so asOf trailing a
    // fresh lastSynced by >36h means the heartbeat moved but roster content didn't.
    // Not applied to transactions/trades/faab or to date-only values.
    const isRoster = rel.startsWith("data/rosters/") || rel === "data/roster-eddies.json";
    if (isRoster && parsed.lastSynced && parsed.asOf && !parsed.asOf.dateOnly) {
      const lag = parsed.lastSynced.end - parsed.asOf.end;
      if (lag > MAX_AGE_MS) {
        fail(`${tag}${rel} asOf "${data.asOf}" trails lastSynced "${data.lastSynced}" by ${(lag / 3600000).toFixed(1)}h (limit 36h)`);
        good = false;
      }
    }
    const staleKeys = parsed.lastSynced ? ["lastSynced"] : Object.keys(parsed);
    for (const k of staleKeys) {
      const age = now - parsed[k].end;
      if (age > MAX_AGE_MS) {
        fail(`${tag}${rel} ${k} "${data[k]}" is stale (${(age / 3600000).toFixed(1)}h old, limit 36h)`);
        good = false;
      }
    }
    if (good) freshOk++;
  }
  console.log(`${tag}Rosters ok (${rosterOk}/${playerFiles.length} files with players)`);
  console.log(`${tag}Freshness ok (${freshOk}/${freshFiles.length} files within 36h)`);
}

// Canonical JSON (sorted keys) so formatting-only differences don't count.
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

async function checkedFiles(base) {
  let rosters = [];
  try {
    rosters = (await readdir(join(base, "data/rosters"))).filter((f) => f.endsWith(".json")).map((f) => `data/rosters/${f}`);
  } catch {}
  return [...new Set([...FRESH_FILES, ...rosters])].sort();
}

async function checkMirror() {
  if (MIRROR_ROOT === "none") return;
  const tag = `[mirror ${MIRROR_ROOT}] `;
  try {
    if (!(await stat(join(MIRROR_ROOT, "data"))).isDirectory()) throw new Error("not a dir");
  } catch {
    console.log(`skipped: mirror path not present (${MIRROR_ROOT})`);
    return;
  }
  const files = (await walk(join(MIRROR_ROOT, "data"))).filter((f) => f.endsWith(".json"));
  for (const file of files) await loadJson(MIRROR_ROOT, relative(MIRROR_ROOT, file), tag);
  console.log(`${tag}JSON checked (${files.length} files)`);
  await checkDataIntegrity(MIRROR_ROOT, `mirror ${MIRROR_ROOT}`);
  // Mirror must carry the same checked data as the site.
  const names = [...new Set([...(await checkedFiles(root)), ...(await checkedFiles(MIRROR_ROOT))])].sort();
  const differ = [];
  for (const rel of names) {
    let a = null, b = null;
    try { a = canon(JSON.parse(await readFile(join(root, rel), "utf8"))); } catch {}
    try { b = canon(JSON.parse(await readFile(join(MIRROR_ROOT, rel), "utf8"))); } catch {}
    if (a === null && b === null) continue;
    if (a === null) differ.push(`${rel} (missing or invalid in site)`);
    else if (b === null) differ.push(`${rel} (missing or invalid in mirror)`);
    else if (a !== b) differ.push(rel);
  }
  if (differ.length) fail(`${tag}differs from site in ${differ.length} checked file(s): ${differ.join(", ")}`);
  else console.log(`${tag}matches site (${names.length} checked files)`);
}

function contentType(file) {
  const ext = extname(file).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };
  return types[ext] || "application/octet-stream";
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        let pathname = decodeURIComponent(url.pathname);
        if (pathname.endsWith("/")) pathname += "index.html";
        const file = join(root, pathname);
        if (!file.startsWith(root)) {
          res.writeHead(403);
          res.end("no");
          return;
        }
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": contentType(file) });
        res.end(body);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

function ignoreConsole(text) {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("cloudflare") ||
    t.includes("abacus.jasoncameron") ||
    t.includes("spotify") ||
    t.includes("fonts.googleapis") ||
    t.includes("fonts.gstatic") ||
    t.includes("favicon.ico") ||
    t.includes("google-analytics") ||
    t.includes("net::err_failed")
  );
}

function chromePath() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && fromEnv.startsWith("/")) return fromEnv;
  const cmd = fromEnv || "google-chrome-stable";
  return execSync(`command -v ${cmd} || command -v google-chrome || command -v chromium`, {
    encoding: "utf8",
    shell: "/bin/bash"
  }).trim().split("\n")[0];
}

async function checkPages() {
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer-core")).default;
  } catch {
    fail("puppeteer-core is not installed (npm install --no-save puppeteer-core)");
    return;
  }
  let executablePath = "";
  try {
    executablePath = chromePath();
  } catch {
    fail("Chrome was not found. Set CHROME_PATH.");
    return;
  }
  const { server, port } = await startServer();
  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  try {
    const page = await browser.newPage();
    for (const viewport of VIEWPORTS) {
      await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
      for (const [name, path] of PAGES) {
        const errors = [];
        const onConsole = (msg) => {
          if (msg.type() !== "error") return;
          const text = msg.text();
          if (ignoreConsole(text)) return;
          // Third-party 429s and blocked beacons show up as resource errors.
          // Local misses are caught on the response listener below.
          if (/^Failed to load resource/i.test(text)) return;
          errors.push(text);
        };
        const onResponse = (res) => {
          const url = res.url();
          if (!url.includes("127.0.0.1")) return;
          if (res.status() < 400) return;
          if (url.endsWith("/favicon.ico")) return;
          errors.push(`${res.status()} ${url}`);
        };
        const onPageError = (err) => {
          const text = String(err && err.message ? err.message : err);
          if (!ignoreConsole(text)) errors.push(text);
        };
        page.on("console", onConsole);
        page.on("pageerror", onPageError);
        page.on("response", onResponse);
        try {
          await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "networkidle0", timeout: 30000 });
          await page.evaluate((week) => {
            try {
              localStorage.setItem(`wuc-week-recap-seen-w${week}`, "1");
              sessionStorage.setItem(`wuc-week-recap-dismissed-w${week}`, "1");
            } catch (_) {}
          }, 4);
          await page.reload({ waitUntil: "networkidle0", timeout: 30000 });
          await new Promise((r) => setTimeout(r, 250));
          if (name === "trades.html") {
            const leaked = await page.evaluate(() => {
              const text = document.body.innerText || "";
              return /pending offers/i.test(text) || Boolean(document.getElementById("tradePending"));
            });
            if (leaked) errors.push("pending trade offers are visible");
          }
          if (name === "standings.html") {
            const info = await page.evaluate(() => {
              const rows = document.querySelectorAll("table.standings-table tbody tr").length;
              const text = document.body.innerText || "";
              const playoff = document.querySelectorAll(".col-playoff").length;
              const hits = (a, b) => a.right > b.left + 0.5 && a.left < b.right - 0.5 && a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5;
              const overlaps = [];
              document.querySelectorAll(".standings-table tbody tr").forEach((row) => {
                const nameEl = row.querySelector(".col-team .team-inline > span:last-child");
                const cell = row.querySelector("td.col-team");
                const rec = row.querySelector("td.col-record");
                const pf = row.querySelector("td.col-num");
                if (!nameEl || !cell || !rec) return;
                const nb = nameEl.getBoundingClientRect();
                const cb = cell.getBoundingClientRect();
                const rb = rec.getBoundingClientRect();
                const label = nameEl.textContent.trim();
                if (nb.right > cb.right + 1 || hits(nb, rb) || (pf && hits(nb, pf.getBoundingClientRect()))) {
                  overlaps.push(label);
                }
              });
              return { rows, playoff, devNote: /simulated seasons|Computed in your browser|schedule file/i.test(text), hasCol: /Playoff %/i.test(text), overlaps };
            });
            if (info.rows < 14) errors.push(`standings table has ${info.rows} rows`);
            if (!info.hasCol || info.playoff < 14) errors.push("standings missing Playoff %");
            if (info.devNote) errors.push("standings shows the old playoff methodology note");
            if (info.overlaps.length) errors.push(`team names overlap columns: ${info.overlaps.slice(0, 3).join(", ")}`);
          }
          if (name === "team-eddies") {
            const info = await page.evaluate(() => {
              const text = document.body.innerText || "";
              const chips = [...document.querySelectorAll("#roster .chip")].map((el) => el.textContent.trim());
              const count = (name) => chips.filter((n) => n === name).length;
              return {
                ok: /Eagle Ridge Eddies/.test(text) && Boolean(document.getElementById("roster")),
                chars: count("Zach Charbonnet"),
                etienne: count("Travis Etienne"),
                raw: /W1 FINAL/.test(text),
                larry: /Saltese Slamm \(Larry\)/.test(text),
                lukeNick: /Saltese Slamm \(Luke\)/.test(text)
              };
            });
            if (!info.ok) errors.push("Eddies team page did not render");
            if (info.chars !== 1 || info.etienne !== 1) errors.push(`IR dupes charbonnet=${info.chars} etienne=${info.etienne}`);
            if (info.raw) errors.push("raw roster note is visible");
            if (info.larry || info.lukeNick) errors.push("trade still uses a nickname owner");
            if (viewport.name === "mobile") {
              const log = await page.evaluate(() => {
                const table = document.querySelector(".week-log");
                const wrap = document.querySelector(".week-log-scroll");
                if (!table || !wrap) return { missing: true };
                const header = table.querySelector("th.col-record");
                const hb = header.getBoundingClientRect();
                const wb = wrap.getBoundingClientRect();
                return {
                  missing: false,
                  header: header.textContent.trim(),
                  overflow: table.scrollWidth - wrap.clientWidth,
                  cut: hb.right > wb.right + 1
                };
              });
              if (log.missing) errors.push("weekly results table missing");
              else if (log.overflow > 1 || log.cut) errors.push(`weekly results overflow ${Math.round(log.overflow)}px`);
              else if (log.header !== "W/L") errors.push(`weekly results header is ${log.header}`);
            }
          }
          if (name === "matchups.html") {
            const live = JSON.parse(await readFile(join(root, "data/matchups-live.json"), "utf8"));
            const feat = (live.matchups || [])[0] || {};
            const pctA = feat.winProb ? Math.round(feat.winProb.sideA * 100) : null;
            const pctB = feat.winProb ? Math.round(feat.winProb.sideB * 100) : null;
            const info = await page.evaluate(() => {
              const main = document.querySelector("main");
              const text = main ? main.innerText : "";
              const html = main ? main.innerHTML : "";
              const cards = [...document.querySelectorAll("[data-matchup]")];
              const first = cards[0] || null;
              const bar = first ? first.querySelector(".winbar:not(.winbar-empty)") : null;
              const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
              return {
                text,
                html,
                n: cards.length,
                featured: first ? first.getAttribute("data-featured") : "",
                firstText: first ? first.innerText : "",
                barLabel: bar ? (bar.getAttribute("aria-label") || "") : "",
                asOf: ((document.getElementById("asOf") || {}).textContent || ""),
                formula: ((document.getElementById("formulaText") || {}).textContent || ""),
                overflow
              };
            });
            const owners = ["Ryan Towner", "Ryan McCallum", "Luke Sahlberg", "Jesse Nicholson", "Kyle Weberg", "Bill Jenson", "Gavin Heaton", "Chase Anderson", "Jacob Crisp", "Tim Brandle", "Brian Aga", "Mike Heff", "Kellen Olson", "Nathan Kelly", "ThiccSwede"];
            if (info.n !== (live.matchups || []).length) errors.push(`live board has ${info.n} matchups`);
            if (feat.featured === true && info.featured !== "yes") errors.push("featured matchup is not first");
            if (feat.sideA && feat.sideB && (!info.firstText.includes(feat.sideA.name) || !info.firstText.includes(feat.sideB.name))) {
              errors.push("featured card names do not match the JSON");
            }
            if (feat.sideA && feat.sideA.teamId === "eddies" && feat.sideB && feat.sideB.teamId === "ultron") {
              if (!/The Eddies vs Ultron/.test(info.firstText)) errors.push("featured card is not Eddies vs Ultron");
            }
            if (pctA != null && (!info.firstText.includes(`${pctA}%`) || !info.firstText.includes(`${pctB}%`))) {
              errors.push(`featured win chance missing ${pctA}/${pctB}`);
            }
            if (pctA != null && feat.sideA && !info.barLabel.includes(`${feat.sideA.name} ${pctA}%`)) {
              errors.push(`win bar label is ${info.barLabel}`);
            }
            const bars = await page.evaluate(() => ({
              filled: document.querySelectorAll(".winbar:not(.winbar-empty)").length,
              unset: document.querySelectorAll("[data-lineup='unset']").length
            }));
            if (bars.filled !== (live.matchups || []).length) errors.push(`filled win bars ${bars.filled}`);
            if (!bars.unset) errors.push("no unset-lineup row");
            if (!/No lineup set/.test(info.text)) errors.push("empty lineup is not labeled");
            if (!/95%/.test(info.text)) errors.push("95% cap is not shown");
            const slateHasTtab = (live.matchups || []).some((g) => (g.sideA && g.sideA.teamId === "ttab") || (g.sideB && g.sideB.teamId === "ttab"));
            if (slateHasTtab && !/TTAB/.test(info.text)) errors.push("TTAB is not on the board");
            if (/Towner Top Aga Bottom/.test(info.html)) errors.push("long TTAB name is visible");
            const named = owners.find((owner) => info.text.includes(owner) || info.html.includes(owner));
            if (named) errors.push(`page names ${named}`);
            if (/\b(pending|bids?|claims?)\b/i.test(info.text)) errors.push("page mentions a bid, claim, or pending item");
            if (!/^as of .+\bPT$/.test(info.asOf.trim())) errors.push(`as-of line is "${info.asOf}"`);
            if (live.asOf && info.asOf.trim() !== `as of ${live.asOf}`) errors.push(`as-of line is "${info.asOf}"`);
            if (!/normal approximation/.test(info.formula) || !/nearest 5%/.test(info.formula)) errors.push("formula is not on the page");
            if (info.overflow > 1) errors.push(`page overflows by ${info.overflow}px`);
          }
          if (name === "index.html") {
            const info = await page.evaluate(() => {
              const rows = document.querySelectorAll("#standingsSnap tbody tr").length;
              const text = document.body.innerText || "";
              const ranks = [...document.querySelectorAll("#topBoard .board-rank")].map((el) => el.textContent.trim());
              return {
                rows,
                eddiesCard: Boolean(document.getElementById("eddiesCard")),
                eddiesHeading: [...document.querySelectorAll("h1,h2")].some((el) => /Eagle Ridge Eddies/.test(el.textContent)),
                ranks
              };
            });
            if (info.rows < 5) errors.push(`home standings snapshot has ${info.rows} rows`);
            if (info.eddiesCard || info.eddiesHeading) errors.push("home still features the Eddies");
            if (info.ranks.join(",") !== "1,2,3,4,5") errors.push(`top board ranks ${info.ranks.join(",")}`);
          }
          if (name === "trades.html") {
            const info = await page.evaluate(() => {
              const text = document.body.innerText || "";
              const imgs = [...document.querySelectorAll("#tradeBlocks img.team-logo")].map((img) => img.getAttribute("src"));
              return {
                green: /Greenacres/i.test(text),
                listedEmpty: /Listed:\s*—/.test(text),
                larry: /\(Larry\)/.test(text),
                imgs,
                sub: /Substation/.test(text) && /Listed:\s*—/.test(text)
              };
            });
            if (info.green) errors.push("trades still show Greenacres");
            if (info.listedEmpty) errors.push("empty trade block is visible");
            if (info.larry) errors.push("trades still say Larry");
            if (!info.imgs.some((src) => src && src.includes("morningside"))) errors.push("morningside logo missing on the block");
          }
          if (name === "rosters.html") {
            const raw = await page.evaluate(() => /W1 FINAL/.test(document.body.innerText || ""));
            if (raw) errors.push("roster cards show a raw internal note");
          }
          if (viewport.name === "desktop" && name === "index.html") {
            const local = await page.evaluate(() => {
              const host = location.hostname;
              const visit = (document.getElementById("visit-count") || {}).textContent || "";
              const beacon = Boolean(document.querySelector("script[src*='cloudflareinsights']"));
              return { host, visit, beacon };
            });
            if (local.beacon) errors.push("Cloudflare beacon loaded on localhost");
            if (local.visit.trim() !== "—") errors.push(`visit counter is ${local.visit}`);
          }
        } catch (err) {
          errors.push(err.message || String(err));
        }
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
        page.off("response", onResponse);
        if (errors.length) {
          fail(`${name} @ ${viewport.name}: ${errors.slice(0, 3).join(" | ")}`);
        } else {
          console.log(`page ok ${name} @ ${viewport.name}`);
        }
      }
      await checkRankAgreement(page, port, viewport.name);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function checkRankAgreement(page, port, viewportName) {
  const ids = ["eddies", "goats", "slumlords", "newman"];
  await page.goto(`http://127.0.0.1:${port}/standings.html`, { waitUntil: "networkidle0", timeout: 30000 });
  const table = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll(".standings-table tbody tr").forEach((row) => {
      const href = (row.querySelector("a.team-link") || {}).getAttribute?.("href") || "";
      const id = new URLSearchParams((href.split("?")[1] || "")).get("id");
      if (!id) return;
      out[id] = {
        rank: (row.querySelector(".col-rank") || {}).textContent.trim(),
        record: (row.querySelector(".col-record") || {}).textContent.trim(),
        pf: (row.querySelector("td.col-num") || {}).textContent.trim()
      };
    });
    return out;
  });
  await page.goto(`http://127.0.0.1:${port}/rankings.html`, { waitUntil: "networkidle0", timeout: 30000 });
  const power = await page.evaluate(() => {
    const week = ((document.getElementById("rankEyebrow") || {}).textContent || "").match(/Week\s+(\d+)/);
    const out = {};
    document.querySelectorAll("li.rank-row").forEach((row) => {
      const href = (row.querySelector("a.team-link") || {}).getAttribute?.("href") || "";
      const id = new URLSearchParams((href.split("?")[1] || "")).get("id");
      if (!id) return;
      out[id] = {
        rank: (row.querySelector(".rank-num") || {}).textContent.trim(),
        week: week ? week[1] : "",
        record: (row.querySelector(".rank-record") || {}).textContent.trim()
      };
    });
    return out;
  });
  for (const id of ids) {
    await page.goto(`http://127.0.0.1:${port}/team.html?id=${id}`, { waitUntil: "networkidle0", timeout: 30000 });
    const info = await page.evaluate(() => {
      const text = (kind) => {
        const el = document.querySelector(`#teamStats [data-kind="${kind}"]`);
        return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
      };
      const pill = document.querySelector('#teamStats [data-kind="power"]');
      const main = document.querySelector("main.wrap");
      const pb = pill ? pill.getBoundingClientRect() : null;
      const mb = main ? main.getBoundingClientRect() : null;
      return {
        power: text("power"),
        standings: text("standings"),
        record: text("record"),
        pf: text("pf"),
        overflow: pb && mb ? pb.right > mb.right + 1 || pb.left < mb.left - 1 : false
      };
    });
    const stand = table[id];
    const board = power[id];
    if (!stand) {
      fail(`${id} missing from standings @ ${viewportName}`);
      continue;
    }
    if (!board) {
      fail(`${id} missing from rankings @ ${viewportName}`);
      continue;
    }
    const expectPower = `Power #${board.rank} (Wk ${board.week})`;
    const expectStand = `Standings #${stand.rank}`;
    if (info.power !== expectPower) fail(`${id} power pill "${info.power}" != "${expectPower}" @ ${viewportName}`);
    if (info.standings !== expectStand) fail(`${id} standings pill "${info.standings}" != "${expectStand}" @ ${viewportName}`);
    if (info.record !== `Record ${stand.record}`) fail(`${id} record pill "${info.record}" != standings ${stand.record} @ ${viewportName}`);
    if (info.pf !== `PF ${stand.pf}`) fail(`${id} PF pill "${info.pf}" != standings ${stand.pf} @ ${viewportName}`);
    if (board.record !== stand.record) fail(`${id} rankings record ${board.record} != standings ${stand.record} @ ${viewportName}`);
    if (info.overflow) fail(`${id} power pill overflows the page @ ${viewportName}`);
  }
}

if (runJson) await checkJson();
if (runJson) await checkDataIntegrity(root, "site");
if (runJson) await checkMirror();
if (runPages) await checkPages();

if (failures.length) {
  console.error(`\n${failures.length} problem(s).`);
  process.exit(1);
}
console.log("\nSite check passed.");

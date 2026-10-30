#!/usr/bin/env node
/**
 * Build data/matchups-live.json for the Live Matchups page.
 *
 *   node scripts/build-matchups-live.mjs
 *   node scripts/build-matchups-live.mjs --raw /path/to/fantrax-raw.json
 *
 * Reads the files the sync already refreshes. data/livescoring-wN.json is the
 * preferred live input (score, proj, done / inProgress / yet). The overlay
 * only fills holes that file left. Missing numbers stay null.
 * The page shows a dash for null. Null is never written as zero.
 *
 * Output schema (schemaVersion 1):
 * {
 *   schemaVersion, season, week, weekStart, weekEnd, windowLabel, timezone,
 *   asOf,            // Pacific clock time, ends with "PT"
 *   status,          // "live" | "final" | "scheduled"
 *   formula: { id, playerSd, unknownTeamSd, roundTo, liveFloor, liveCeil, text },
 *   sources: [ "...relative files..." ],
 *   matchups: [
 *     {
 *       id, featured, status,   // "live" | "final" | "scheduled"
 *       place,                  // "at" (side A at side B) or "vs"
 *       sideA, sideB: {
 *         teamId, name, color, logo, record, lineupSet,
 *         score, projection, playersLeft,   // number or null; playersLeft is yet-to-play
 *         playersDone, playersInProgress, minutesRemaining
 *       },
 *       winProb: null | {
 *         sideA, sideB,          // 0–1, on a 5% grid (100/0 only when decided)
 *         mu, sigma, decided, playersLeftKnown
 *       }
 *     }
 *   ]
 * }
 *
 * The featured pair (Eagle Ridge Eddies vs Ultron) is first when both are
 * in the slate. Public names only: Towner Top Aga Bottom is written as TTAB.
 * Owner names, bids, claims, and trades are not copied.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA, assertFormula, winProbability } from "../js/live-prob.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEEK1_THURSDAY = "2026-09-10";
const FEATURED = ["eddies", "ultron"];
const ACTIVE_CAP = 14;

const ALIAS = {
  "greenacres goblins": "hyper",
  hypersecretors: "hyper",
  "the hypersecretors": "hyper",
  "towner top aga bottom": "ttab",
  ttab: "ttab",
  "pocket agents": "pocket",
  substation: "substation",
  ultron: "ultron",
  "saltese slamm": "saltese",
  "eagle ridge eddies": "eddies",
  "the eddies": "eddies",
  eddies: "eddies",
  "indian trail slumlords": "slumlords",
  "mrs doubtpfizer": "doubtpfizer",
  "drummond dongers": "dongers",
  "morningside muff divers": "morningside",
  "newman lake sleep paralysis demons": "newman",
  "little ass boys": "lab",
  "valley old goats": "goats"
};

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : "";
}

async function readJson(rel) {
  const text = await readFile(join(root, rel), "utf8");
  return JSON.parse(text);
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

function prettyDate(iso, withYear) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, d] = iso.split("-").map(Number);
  const body = `${months[m - 1]} ${d}`;
  return withYear ? `${body}, ${y}` : body;
}

function windowLabel(start, end) {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${prettyDate(start, !sameYear)} – ${prettyDate(end, true)}`;
}

function weekFinal(week) {
  if (!week) return false;
  if (String(week.weekStatus || "").toLowerCase() === "final") return true;
  if (week.complete === true) return true;
  const ms = week.matchups || [];
  return ms.length > 0 && ms.every((m) => String(m.status || "").toLowerCase() === "final");
}

function resolveId(label, teams) {
  const raw = String(label || "").trim();
  if (!raw) return null;
  if (teams.some((t) => t.id === raw)) return raw;
  const n = norm(raw);
  if (ALIAS[n]) return ALIAS[n];
  for (const t of teams) {
    if (norm(t.name) === n || norm(t.shortName) === n || norm(t.short) === n || norm(t.abbrev) === n) return t.id;
  }
  return null;
}

function publicName(team) {
  if (!team) return "—";
  if (team.id === "ttab") return "TTAB";
  return team.name;
}

function numOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function leftOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > ACTIVE_CAP) return null;
  return n;
}

function recordLabel(row) {
  if (!row || !row.played) return null;
  return row.ties ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`;
}

function emptySide(team) {
  return {
    teamId: team.id,
    name: publicName(team),
    color: team.color || "#69BE28",
    logo: `img/logos/${team.id}.jpg`,
    record: null,
    lineupSet: true,
    score: null,
    projection: null,
    playersLeft: null,
    playersDone: null,
    playersInProgress: null,
    minutesRemaining: null
  };
}

function sideById(matchup, id) {
  if (matchup.sideA.teamId === id) return matchup.sideA;
  if (matchup.sideB.teamId === id) return matchup.sideB;
  return null;
}

function findPair(matchups, id1, id2) {
  return matchups.find((m) => {
    const ids = [m.sideA.teamId, m.sideB.teamId];
    return ids.includes(id1) && ids.includes(id2);
  }) || null;
}

function fillSide(side, patch) {
  if (!side || !patch) return;
  if (side.score == null && patch.score != null) side.score = patch.score;
  if (side.projection == null && patch.projection != null) side.projection = patch.projection;
  if (side.playersLeft == null && patch.playersLeft != null) side.playersLeft = patch.playersLeft;
}

/* place "at" means side A is the visitor. Only set when the source says so. */
function applyGame(matchups, spec) {
  const game = findPair(matchups, spec.idA, spec.idB);
  if (!game) return false;
  if (spec.place === "at" && game.sideA.teamId === spec.idB && game.sideB.teamId === spec.idA) {
    const swap = game.sideA;
    game.sideA = game.sideB;
    game.sideB = swap;
  }
  if (spec.place === "at") game.place = "at";
  fillSide(sideById(game, spec.idA), spec.a);
  fillSide(sideById(game, spec.idB), spec.b);
  if (spec.final === true) game.status = "final";
  return true;
}

function playersLeftFromRoster(data) {
  if (!data || typeof data !== "object") return null;
  const explicit = leftOrNull(data.playersLeft != null ? data.playersLeft : data.yetToPlay);
  if (explicit != null && (data.playersLeft != null || data.yetToPlay != null)) return explicit;
  const roster = data.roster;
  if (!roster || typeof roster !== "object") return null;
  let seen = false;
  let left = 0;
  for (const [pos, arr] of Object.entries(roster)) {
    if (!Array.isArray(arr)) continue;
    if (/ir|pending|taxi|reserve/i.test(pos)) continue;
    for (const player of arr) {
      if (!player || typeof player !== "object") continue;
      const status = String(player.status || player.gameStatus || "").toLowerCase();
      const flagged = player.played != null || player.yetToPlay != null || status !== "";
      if (!flagged) continue;
      seen = true;
      const played = player.played === true || status === "played" || status === "final" || status === "bye";
      const yet = player.yetToPlay === true || player.played === false || status === "yet" || status === "scheduled";
      if (yet && !played) left += 1;
    }
  }
  if (!seen) return null;
  return left <= ACTIVE_CAP ? left : null;
}

function clockFromInstant(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h12",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit"
  }).formatToParts(new Date(ms));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")} ${g("dayPeriod").toUpperCase()} PT`;
}

function clockToPt(value) {
  const v = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : clockFromInstant(ms);
  }
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*(PT|PDT|PST)$/i);
  if (!m) return null;
  let h = Number(m[4]);
  const ap = (m[7] || "").toUpperCase();
  const min = m[5];
  if (ap) {
    if (h < 1 || h > 12) return null;
    const show = h === 0 ? 12 : h;
    return `${m[1]}-${m[2]}-${m[3]} ${show}:${min} ${ap} PT`;
  }
  if (h > 23) return null;
  const suffix = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${m[1]}-${m[2]}-${m[3]} ${h12}:${min} ${suffix} PT`;
}

function headerFromRaw(raw) {
  const header = raw && raw.week8_header;
  if (!header || typeof header !== "object") return null;
  const score = String(header.score || "");
  const parts = score.split("-").map((s) => Number(String(s).trim()));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const away = header.eddies_home_or_away === "home" ? header.opponent : "Eagle Ridge Eddies";
  const home = header.eddies_home_or_away === "home" ? "Eagle Ridge Eddies" : (header.opponent || "Ultron");
  const eddiesScore = parts[0];
  const oppScore = parts[1];
  const eddiesIsAway = header.eddies_home_or_away !== "home";
  return {
    asOf: clockToPt(raw.scraped) || clockToPt(header.scraped),
    games: [{
      away,
      home,
      awayScore: eddiesIsAway ? eddiesScore : oppScore,
      homeScore: eddiesIsAway ? oppScore : eddiesScore,
      awayProjection: eddiesIsAway ? numOrNull(header.eddies_proj) : numOrNull(header.opp_proj),
      homeProjection: eddiesIsAway ? numOrNull(header.opp_proj) : numOrNull(header.eddies_proj)
    }]
  };
}

function gamesFromOverlay(overlay) {
  if (!overlay || typeof overlay !== "object") return [];
  const list = overlay.games || overlay.matchups || [];
  return Array.isArray(list) ? list : [];
}

function patchFromSides(teams, game) {
  const awayName = game.away || game.awayTeam;
  const homeName = game.home || game.homeTeam;
  const idA = resolveId(awayName, teams);
  const idB = resolveId(homeName, teams);
  if (!idA || !idB) return null;
  return {
    idA,
    idB,
    place: "at",
    final: String(game.status || "").toLowerCase() === "final",
    a: {
      score: numOrNull(game.awayScore != null ? game.awayScore : game.away_listed_score),
      projection: numOrNull(game.awayProjection != null ? game.awayProjection : game.awayProj != null ? game.awayProj : game.away_projection),
      playersLeft: leftOrNull(game.awayPlayersLeft != null ? game.awayPlayersLeft : game.awayYetToPlay)
    },
    b: {
      score: numOrNull(game.homeScore != null ? game.homeScore : game.home_listed_score),
      projection: numOrNull(game.homeProjection != null ? game.homeProjection : game.homeProj != null ? game.homeProj : game.home_projection),
      playersLeft: leftOrNull(game.homePlayersLeft != null ? game.homePlayersLeft : game.homeYetToPlay)
    }
  };
}

function chooseLiveWeek(scores, schedule) {
  const weeks = (schedule && schedule.weeks) || {};
  const w = Number(scores && scores.week) || 0;
  if (w && !weekFinal(scores) && Array.isArray(scores.matchups) && scores.matchups.length) return w;
  const next = w + 1;
  if (weeks[String(next)] || weeks[next]) return next;
  return w || 1;
}

function pairsFor(schedule, week) {
  const weeks = (schedule && schedule.weeks) || {};
  const pairs = weeks[String(week)] || weeks[week] || [];
  return Array.isArray(pairs) ? pairs : [];
}

async function loadFinalWeeks(scores) {
  const season = (scores && scores.season) || 2026;
  const map = new Map();
  const add = (data) => {
    if (!data || !weekFinal(data) || !Array.isArray(data.matchups)) return;
    const w = Number(data.week);
    if (!w || map.has(w)) return;
    map.set(w, data);
  };
  let names = [];
  try {
    names = (await readdir(join(root, "data"))).filter((f) => new RegExp(`^scores-w\\d+-${season}\\.json$`).test(f));
  } catch {
    names = [];
  }
  for (const name of names) add(await readJson(`data/${name}`));
  add(scores);
  return [...map.values()];
}

function recordsFrom(weeks, teams) {
  const table = Object.fromEntries(teams.map((t) => [t.id, { wins: 0, losses: 0, ties: 0, played: 0 }]));
  for (const week of weeks) {
    for (const m of week.matchups || []) {
      const home = resolveId(m.home, teams);
      const away = resolveId(m.away, teams);
      const hs = Number(m.homeScore);
      const as = Number(m.awayScore);
      if (!home || !away || !Number.isFinite(hs) || !Number.isFinite(as)) continue;
      table[home].played += 1;
      table[away].played += 1;
      if (hs > as) {
        table[home].wins += 1;
        table[away].losses += 1;
      } else if (as > hs) {
        table[away].wins += 1;
        table[home].losses += 1;
      } else {
        table[home].ties += 1;
        table[away].ties += 1;
      }
    }
  }
  return table;
}

function gameStatus(game) {
  if (game.status === "final") return "final";
  const a = game.sideA;
  const b = game.sideB;
  const unset = a.lineupSet === false || b.lineupSet === false;
  if (!unset && a.playersLeft === 0 && b.playersLeft === 0 && a.score != null && b.score != null) return "final";
  if (a.score != null || b.score != null) return "live";
  return "scheduled";
}

function attachWin(game) {
  const status = gameStatus(game);
  game.status = status;
  const prob = winProbability({
    scoreA: game.sideA.score,
    projA: game.sideA.projection,
    leftA: game.sideA.playersLeft,
    scoreB: game.sideB.score,
    projB: game.sideB.projection,
    leftB: game.sideB.playersLeft,
    emptyA: game.sideA.lineupSet === false,
    emptyB: game.sideB.lineupSet === false,
    final: status === "final"
  });
  game.winProb = prob;
}

function intOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/* proj 0 with nobody done, in progress, or yet to play is an unset lineup. */
function rowLineupSet(row) {
  const note = String((row && row.note) || "");
  if (/empty|unset lineup/i.test(note)) return false;
  const proj = numOrNull(row.proj != null ? row.proj : row.projection);
  const yet = intOrNull(row.yet != null ? row.yet : row.yetToPlay);
  const done = intOrNull(row.done);
  const ip = intOrNull(row.inProgress);
  if (proj === 0 && yet === 0 && done === 0 && ip === 0) return false;
  return true;
}

function sideFromLiveRow(row) {
  const yet = intOrNull(row.yet != null ? row.yet : row.yetToPlay);
  return {
    score: numOrNull(row.score),
    projection: numOrNull(row.proj != null ? row.proj : row.projection),
    playersLeft: yet,
    playersDone: intOrNull(row.done),
    playersInProgress: intOrNull(row.inProgress),
    minutesRemaining: intOrNull(row.min != null ? row.min : row.minutesRemaining),
    lineupSet: rowLineupSet(row)
  };
}

function writeSide(side, patch) {
  if (!side || !patch) return;
  if (patch.score != null) side.score = patch.score;
  if (patch.projection != null) side.projection = patch.projection;
  if (patch.playersLeft != null) side.playersLeft = patch.playersLeft;
  if (patch.playersDone != null) side.playersDone = patch.playersDone;
  if (patch.playersInProgress != null) side.playersInProgress = patch.playersInProgress;
  if (patch.minutesRemaining != null) side.minutesRemaining = patch.minutesRemaining;
  if (patch.lineupSet != null) side.lineupSet = patch.lineupSet;
}

/* Fantrax live scoring: matchups is a list of [club, club] rows. Preferred over the overlay. */
function applyLiveScoring(matchups, teams, live) {
  const list = live && Array.isArray(live.matchups) ? live.matchups : [];
  let applied = 0;
  for (const pair of list) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const idA = resolveId(pair[0] && pair[0].team, teams);
    const idB = resolveId(pair[1] && pair[1].team, teams);
    const game = idA && idB ? findPair(matchups, idA, idB) : null;
    if (!game) continue;
    writeSide(sideById(game, idA), sideFromLiveRow(pair[0]));
    writeSide(sideById(game, idB), sideFromLiveRow(pair[1]));
    applied += 1;
  }
  return applied;
}

function newestRosterClock(rosterFiles) {
  let best = null;
  for (const data of rosterFiles) {
    const clock = clockToPt(data && (data.lastSynced || data.asOf));
    if (clock && (!best || clock > best)) best = clock;
  }
  return best;
}

const BANNED_KEYS = new Set(["owner", "owners", "pending", "pendingclaim", "pendingclaims", "bid", "bids", "claim", "claims", "trade", "trades"]);

function walkKeys(value, path, hits) {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (BANNED_KEYS.has(key.toLowerCase())) hits.push(`${path}.${key}`);
    walkKeys(value[key], `${path}.${key}`, hits);
  }
}

export async function buildMatchups(options = {}) {
  assertFormula();
  const sources = ["data/schedule.json", "data/scores.json", "data/teams.json", "data/rosters/"];
  const schedule = await readJson("data/schedule.json");
  const scores = await readJson("data/scores.json");
  const teamsFile = await readJson("data/teams.json");
  const teams = (teamsFile.teams || []).filter((t) => t && t.id);
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  const week = chooseLiveWeek(scores, schedule);
  const start = addDays(WEEK1_THURSDAY, (week - 1) * 7);
  const end = addDays(start, 6);
  const pairs = pairsFor(schedule, week);
  const matchups = [];
  pairs.forEach((pair, i) => {
    if (!Array.isArray(pair) || pair.length < 2) return;
    const a = byId[resolveId(pair[0], teams)];
    const b = byId[resolveId(pair[1], teams)];
    if (!a || !b) return;
    matchups.push({
      id: `w${week}-${a.id}-${b.id}`,
      featured: false,
      status: "scheduled",
      place: "vs",
      sideA: emptySide(a),
      sideB: emptySide(b),
      winProb: null,
      order: i
    });
  });

  const finalWeeks = await loadFinalWeeks(scores);
  const records = recordsFrom(finalWeeks, teams);
  for (const game of matchups) {
    game.sideA.record = recordLabel(records[game.sideA.teamId]);
    game.sideB.record = recordLabel(records[game.sideB.teamId]);
  }

  if (Number(scores && scores.week) === week) {
    sources.push("data/scores.json#week");
    for (const m of scores.matchups || []) {
      applyGame(matchups, {
        idA: resolveId(m.away, teams),
        idB: resolveId(m.home, teams),
        place: "at",
        final: String(m.status || scores.weekStatus || "").toLowerCase() === "final" || weekFinal(scores),
        a: {
          score: numOrNull(m.awayScore),
          projection: numOrNull(m.awayProjection != null ? m.awayProjection : m.awayProj),
          playersLeft: leftOrNull(m.awayPlayersLeft != null ? m.awayPlayersLeft : m.awayYetToPlay)
        },
        b: {
          score: numOrNull(m.homeScore),
          projection: numOrNull(m.homeProjection != null ? m.homeProjection : m.homeProj),
          playersLeft: leftOrNull(m.homePlayersLeft != null ? m.homePlayersLeft : m.homeYetToPlay)
        }
      });
    }
  }

  let overlay = null;
  try {
    overlay = await readJson("data/matchups-live.overlay.json");
    sources.push("data/matchups-live.overlay.json");
  } catch {
    overlay = null;
  }
  let asOf = clockToPt(overlay && (overlay.asOf || overlay.scraped));
  for (const game of gamesFromOverlay(overlay)) {
    const spec = patchFromSides(teams, game);
    if (spec) applyGame(matchups, spec);
  }

  const rawPath = options.raw || "";
  if (rawPath) {
    const raw = JSON.parse(await readFile(rawPath, "utf8"));
    const header = headerFromRaw(raw);
    if (header) {
      sources.push(`raw:${relative(root, rawPath)}`);
      if (!asOf) asOf = header.asOf;
      for (const game of header.games) {
        const spec = patchFromSides(teams, game);
        if (spec) applyGame(matchups, spec);
      }
    }
  }

  const rosterDir = join(root, "data/rosters");
  let rosterNames = [];
  try {
    rosterNames = (await readdir(rosterDir)).filter((f) => f.endsWith(".json") && f !== "index.json");
  } catch {
    rosterNames = [];
  }
  const rosterPayloads = [];
  for (const name of rosterNames) {
    const data = await readJson(`data/rosters/${name}`);
    rosterPayloads.push(data);
    const id = data.teamId || name.replace(/\.json$/, "");
    const left = playersLeftFromRoster(data);
    if (left == null) continue;
    for (const game of matchups) {
      fillSide(sideById(game, id), { playersLeft: left });
    }
  }
  if (!asOf) asOf = newestRosterClock(rosterPayloads);
  if (!asOf) asOf = clockToPt(scores && (scores.asOf || scores.updated)) || `${start} 12:00 PM PT`;

  /* Live scoring wins over the overlay, the raw header, and roster counts. */
  let liveScoring = null;
  const liveRel = `data/livescoring-w${week}.json`;
  try {
    liveScoring = await readJson(liveRel);
  } catch {
    liveScoring = null;
  }
  if (liveScoring && (!liveScoring.week || Number(liveScoring.week) === week)) {
    const applied = applyLiveScoring(matchups, teams, liveScoring);
    if (applied) {
      sources.push(liveRel);
      const clock = clockToPt(liveScoring.asOf || liveScoring.scraped);
      if (clock) asOf = clock;
    }
  }

  for (const game of matchups) {
    const ids = [game.sideA.teamId, game.sideB.teamId];
    game.featured = FEATURED.every((id) => ids.includes(id));
    attachWin(game);
    delete game.order;
  }
  matchups.sort((a, b) => Number(b.featured) - Number(a.featured));

  const statuses = matchups.map((m) => m.status);
  let status = "scheduled";
  if (statuses.length && statuses.every((s) => s === "final")) status = "final";
  else if (statuses.some((s) => s === "live" || s === "final")) status = "live";

  const out = {
    schemaVersion: 1,
    season: Number((scores && scores.season) || (schedule && schedule.season) || 2026),
    week,
    weekStart: start,
    weekEnd: end,
    windowLabel: windowLabel(start, end),
    timezone: "PT",
    asOf,
    status,
    formula: {
      id: FORMULA.id,
      playerSd: FORMULA.playerSd,
      unknownTeamSd: FORMULA.unknownTeamSd,
      roundTo: FORMULA.roundTo,
      liveFloor: FORMULA.liveFloor,
      liveCeil: FORMULA.liveCeil,
      text: FORMULA.text
    },
    sources,
    matchups
  };

  const owners = teams.map((t) => t.owner).filter(Boolean);
  const blob = JSON.stringify(out);
  const leaked = owners.filter((name) => blob.includes(name));
  if (leaked.length) throw new Error("refusing to write owner names: " + leaked.join(", "));
  if (blob.includes("Towner Top Aga Bottom")) throw new Error("TTAB must be the public name");
  const badKeys = [];
  walkKeys(out, "$", badKeys);
  if (badKeys.length) throw new Error("refusing banned keys: " + badKeys.join(", "));
  return out;
}

async function main() {
  const raw = readArg("--raw");
  const out = await buildMatchups({ raw });
  const dest = join(root, "data/matchups-live.json");
  await writeFile(dest, JSON.stringify(out, null, 2) + "\n");
  const featured = out.matchups.find((m) => m.featured);
  const line = featured
    ? `${featured.sideA.name} ${featured.sideA.score ?? "—"} (proj ${featured.sideA.projection ?? "—"}) ${featured.place} ${featured.sideB.name} ${featured.sideB.score ?? "—"} (proj ${featured.sideB.projection ?? "—"})`
    : "no featured game";
  console.log(`Wrote data/matchups-live.json — week ${out.week} ${out.windowLabel} — ${out.matchups.length} games — as of ${out.asOf}`);
  console.log(line);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

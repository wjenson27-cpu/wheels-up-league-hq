#!/usr/bin/env node
/* Refresh / stale rules, plus the private trade desk.
   Week score files are read only. Their keys are not rewritten. */
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_FILE,
  REFRESH_MS,
  STALE_AFTER_MS,
  cacheBust,
  evaluateFreshness,
  isGameWindow,
  mergeRefresh,
  parseDataTimestamp,
  ptToUtc,
  shouldRefresh,
  sourceFiles,
  updatedLabel
} from "../js/live-refresh.js";
import {
  activeCounts,
  addWeekLogs,
  applyDeal,
  clubName,
  dealPoints,
  depthEdge,
  depthReport,
  lineupFromScoring,
  loggedTotal,
  playerKey,
  pointsEdge,
  rosterPlayers
} from "../private/trade-analyzer.js";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];

function fail(msg) {
  failures.push(msg);
  console.error("FAIL", msg);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

async function readJson(rel) {
  return JSON.parse(await readFile(join(root, rel), "utf8"));
}

async function exists(rel) {
  try {
    return (await stat(join(root, rel))).isFile();
  } catch {
    return false;
  }
}

const live = await readJson("data/matchups-live.json");
const livescoring = await readJson("data/livescoring-w8.json");
const timed = parseDataTimestamp(live.asOf);
const iso = parseDataTimestamp(livescoring.asOf);
assert(timed && !timed.dateOnly, `matchups asOf did not parse: ${live.asOf}`);
assert(iso && iso.end === timed.end, "livescoring ISO and matchups asOf are not the same instant");
assert(String(live.asOf).trim().endsWith("PT"), "matchups asOf does not end with PT");

const thursday = ptToUtc(2026, 10, 29, 18, 0, 0);
const friday = ptToUtc(2026, 10, 30, 18, 0, 0);
const sunday = ptToUtc(2026, 11, 1, 15, 0, 0);
const monday = ptToUtc(2026, 11, 2, 20, 0, 0);
const tuesday = ptToUtc(2026, 11, 3, 12, 0, 0);
const saturday = ptToUtc(2026, 10, 31, 12, 0, 0);
assert(isGameWindow(thursday) && isGameWindow(sunday) && isGameWindow(monday), "Thu/Sun/Mon PT should be the game window");
assert(!isGameWindow(friday) && !isGameWindow(tuesday) && !isGameWindow(saturday), "Fri/Tue/Sat PT should be outside the game window");

const age46 = evaluateFreshness({ stamp: "2026-10-29 5:14 PM PT", now: thursday, missing: false });
const age45 = evaluateFreshness({ stamp: "2026-10-29 5:15 PM PT", now: thursday, missing: false });
const age44 = evaluateFreshness({ stamp: "2026-10-29 5:16 PM PT", now: thursday, missing: false });
assert(age46.stale && age46.ageMs === 46 * 60000, `46 min should be stale, got ${age46.ageMs}`);
assert(!age45.stale && age45.ageMs === STALE_AFTER_MS, "45 min exactly is not older than 45");
assert(!age44.stale && age44.label === "updated 44 min ago", `44 min label ${age44.label}`);
assert(age46.reasonText.includes("PT"), "stale reason should name PT");
assert(updatedLabel(0) === "updated 0 min ago", "zero minutes label");

const fridayOld = evaluateFreshness({ stamp: live.asOf, now: friday, missing: false });
assert(!fridayOld.stale && /^updated \d+ min ago$/.test(fridayOld.label), `Friday should keep an age without STALE (${fridayOld.label})`);
const sundayOld = evaluateFreshness({ stamp: live.asOf, now: sunday, missing: false });
assert(sundayOld.stale && sundayOld.ageMs > STALE_AFTER_MS, "Sunday afternoon should mark the Friday morning file STALE");

const missingTuesday = evaluateFreshness({ stamp: live.asOf, now: tuesday, missing: true });
const missingSunday = evaluateFreshness({ stamp: null, now: sunday, missing: true });
assert(missingTuesday.stale && missingSunday.stale, "a missing file is STALE inside and outside the window");
assert(missingSunday.label === "", "a missing file with no stamp does not invent an age");

const sameDay = evaluateFreshness({ stamp: "2026-11-01", now: sunday, missing: false });
assert(sameDay.label === "updated today" && !sameDay.stale, "a date-only stamp still on that PT day is not a 45-min stale");

const weekFiles = [];
for (let week = 1; week <= 7; week += 1) weekFiles.push(`data/scores-w${week}-2026.json`);
weekFiles.push("data/scores.json");
for (const rel of weekFiles) {
  const data = await readJson(rel);
  const parsed = parseDataTimestamp(data.asOf);
  assert(parsed, `${rel} asOf ${data.asOf} did not parse`);
  const verdict = evaluateFreshness({ stamp: data.asOf, now: sunday, missing: false });
  assert(verdict.stale, `${rel} should be stale on Sun Nov 1 2026`);
  assert(/^updated \d+ min ago$/.test(verdict.label), `${rel} label ${verdict.label}`);
  assert(data.week != null && Array.isArray(data.matchups), `${rel} lost its week or matchups shape`);
}

const sources = sourceFiles(live);
assert(sources[0] === LIVE_FILE, "live file is the first refresh target");
assert(sources.includes("data/livescoring-w8.json"), "livescoring file is refreshed");
assert(sources.includes("data/scores.json"), "scores.json is refreshed");
assert(!sources.some((file) => file.endsWith("/")), "a directory is not fetched as a file");
assert(cacheBust("data/matchups-live.json", 10) === "data/matchups-live.json?v=10", "cache bust query");

assert(shouldRefresh({ now: 0, lastAttemptMs: null, inWindow: true }), "first game-window fetch should run");
assert(!shouldRefresh({ now: REFRESH_MS - 1, lastAttemptMs: 0, inWindow: true }), "under 30 min should wait");
assert(shouldRefresh({ now: REFRESH_MS, lastAttemptMs: 0, inWindow: true }), "30 min should refresh");
assert(!shouldRefresh({ now: REFRESH_MS * 2, lastAttemptMs: 0, inWindow: false }), "outside the window should not poll");

const prev = {
  asOf: live.asOf,
  matchups: [{ sideA: { score: 33 }, sideB: { score: null } }]
};
const kept = mergeRefresh(prev, { ok: false, status: 404 });
assert(kept.kept && kept.missing && kept.data === prev, "404 keeps the same payload object");
assert(kept.data.matchups[0].sideA.score === 33 && kept.data.matchups[0].sideB.score === null, "404 must not fill a score");
const blip = mergeRefresh(prev, { ok: false, status: 0 });
assert(blip.kept && !blip.missing && blip.data.matchups[0].sideB.score === null, "a network blip keeps the last scores");
const empty = mergeRefresh(null, { ok: false, status: 500 });
assert(empty.data === null && empty.missing && !empty.kept, "a first failure invents no matchup");
const replaced = mergeRefresh(prev, { ok: true, data: { matchups: [{ sideA: { score: 40 }, sideB: { score: 1 } }] } });
assert(!replaced.kept && replaced.data.matchups[0].sideA.score === 40, "a good file replaces the board");

const scoring = await readJson("data/scoring.json");
const lineup = lineupFromScoring(scoring);
assert(lineup && lineup.QB === 1 && lineup.DB === 2 && lineup.ID === 3 && lineup.RWT === 3, "lineup slots drifted from scoring.json");
const eddiesRoster = await readJson("data/rosters/eddies.json");
const ultronRoster = await readJson("data/rosters/ultron.json");
const eddies = rosterPlayers(eddiesRoster);
const ultron = rosterPlayers(ultronRoster);
const eddiesCounts = activeCounts(eddies);
const ultronCounts = activeCounts(ultron);
assert(eddiesCounts.LB > 0 && eddiesCounts.DB > 0 && eddiesCounts.DL > 0, "Eddies IDP was not counted");
assert(ultronCounts.LB > 0 && ultronCounts.DB > 0 && ultronCounts.DL > 0, "Ultron IDP was not counted");
const te = eddies.find((player) => !player.ir && player.pos === "TE");
const dl = ultron.find((player) => !player.ir && player.pos === "DL");
assert(te && eddiesCounts.TE === 1, "expected one active Eddies TE in the current roster");
assert(dl && ultronCounts.DL === 1, "expected one active Ultron DL in the current roster");
const eddiesAfter = applyDeal(eddies, [te.key], [dl]);
const ultronAfter = applyDeal(ultron, [dl.key], [te]);
const beforeE = depthReport(eddiesCounts, lineup);
const afterE = depthReport(activeCounts(eddiesAfter), lineup);
const beforeU = depthReport(ultronCounts, lineup);
const afterU = depthReport(activeCounts(ultronAfter), lineup);
assert(beforeE.starters === 14 && beforeU.starters === 14, "both clubs should fill 14 starters before the deal");
assert(afterE.holes.some((hole) => hole.pos === "TE" && hole.group === "offense"), "sending the only TE opens an offense hole");
assert(afterU.holes.some((hole) => hole.pos === "DL" && hole.group === "IDP"), "sending the only DL opens an IDP hole");
assert(afterE.starters === 13 && afterU.starters === 13, "each side should drop one starter");
const edge = depthEdge(beforeE, afterE, beforeU, afterU);
assert(edge.side === "even" && edge.netStarters === 0, "equal starter losses should not invent a depth winner");

const logs = new Map();
addWeekLogs(logs, { week: 1, matchups: [{ topScorers: [{ player: "Brock Bowers", pts: 20 }] }] });
addWeekLogs(logs, { week: 1, matchups: [{ topScorers: [{ player: "Brock Bowers", pts: 99 }] }] });
addWeekLogs(logs, { week: 2, matchups: [{ topScorers: [{ player: "Brock Bowers", pts: 5.5 }] }] });
assert(loggedTotal(logs, playerKey("Brock Bowers")) === 25.5, "same week must not be double counted");
const partial = dealPoints(logs, [
  { name: "Brock Bowers", key: playerKey("Brock Bowers") },
  { name: "Nobody Special", key: "nobody special" }
]);
assert(partial.sum === null && partial.missing === 1 && partial.knownSum === 25.5, "a missing log is not stored as zero");
assert(partial.rows[1].pts === null, "missing player points stayed null");
const full = dealPoints(logs, [{ name: "Brock Bowers", key: playerKey("Brock Bowers") }]);
assert(full.sum === 25.5 && pointsEdge(full, full).side === "even", "complete logs can be compared");

const realLogs = new Map();
for (let week = 1; week <= 7; week += 1) addWeekLogs(realLogs, await readJson(`data/scores-w${week}-2026.json`));
const beforeLatest = new Map();
for (const [key, weeks] of realLogs) beforeLatest.set(key, new Map(weeks));
addWeekLogs(realLogs, await readJson("data/scores.json"));
for (const [key, weeks] of realLogs) {
  const prior = beforeLatest.get(key);
  if (!prior) continue;
  for (const [week, pts] of prior) {
    if (weeks.get(week) !== pts) fail(`week ${week} points for ${key} changed when scores.json was added`);
  }
}

const config = await readFile(join(root, "js/config.js"), "utf8");
assert(config.includes('featuredTeam: "Eagleridge Eddie\'s"'), "featuredTeam is not Eagleridge Eddie's");
assert(clubName("eddies", "Eagle Ridge Eddies", "Eagleridge Eddie's") === "Eagleridge Eddie's", "club name must use the featured display name");
assert(clubName("ttab", "Towner Top Aga Bottom", "Eagleridge Eddie's") === "TTAB", "TTAB public name");

assert(!(await exists(".nojekyll")), ".nojekyll would publish private/");
const yml = await readFile(join(root, "_config.yml"), "utf8");
assert(/\bprivate\b/.test(yml), "_config.yml does not exclude private");
const analyzer = await readFile(join(root, "private/trade-analyzer.html"), "utf8");
assert(/noindex/.test(analyzer), "trade analyzer is missing noindex");

const owners = (await readJson("data/teams.json")).teams.map((team) => team.owner).filter((name) => name && String(name).trim());
const published = [];
for (const rel of ["matchups.html", "js/matchups-page.js", "js/live-refresh.js", "js/main.js", "css/styles.css"]) {
  published.push([rel, await readFile(join(root, rel), "utf8")]);
}
const { readdir } = await import("node:fs/promises");
for (const name of await readdir(root)) {
  if (name.endsWith(".html")) published.push([name, await readFile(join(root, name), "utf8")]);
}
for (const [rel, text] of published) {
  if (rel.startsWith("private/")) continue;
  if (/trade-analyzer|private\//.test(text)) fail(`${rel} links the trade desk`);
  if (text.includes("billTeam")) fail(`${rel} contains billTeam`);
}
for (const rel of ["private/trade-analyzer.html", "private/trade-analyzer.js", "js/live-refresh.js"]) {
  const text = await readFile(join(root, rel), "utf8");
  for (const owner of owners) {
    if (text.includes(owner)) fail(`${rel} names ${owner}`);
  }
  if (/\bBill\b/.test(text) || text.includes("billTeam")) fail(`${rel} identifies an owner`);
}

const page = await readFile(join(root, "matchups.html"), "utf8");
const pageJs = await readFile(join(root, "js/matchups-page.js"), "utf8");
assert(page.includes('id="updatedAgo"') && page.includes('id="staleRow"'), "matchups.html is missing the freshness line");
assert(pageJs.includes("live-refresh.js") && pageJs.includes("cacheBust"), "matchups page does not refresh");
assert(!page.includes("trade-analyzer"), "matchups links the trade desk");

console.log(`Refresh checks ok (${weekFiles.length} week files, ${relative(root, join(root, "private/trade-analyzer.html"))})`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s).`);
  process.exit(1);
}
console.log("\nLive refresh check passed.");

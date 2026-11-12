#!/usr/bin/env node
/* Refresh / stale rules for the live matchups page.
   Week score files are read only. Their keys are not rewritten. */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { clockFromInstant, clockToPt, buildMatchups } from "./build-matchups-live.mjs";
import {
  LIVE_FILE,
  REFRESH_MS,
  STALE_AFTER_MS,
  cacheBust,
  epochMinute,
  evaluateFreshness,
  isGameWindow,
  mergeRefresh,
  parseDataTimestamp,
  ptToUtc,
  sameEpochMinute,
  shouldRefresh,
  sourceFiles,
  updatedLabel
} from "../js/live-refresh.js";

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

function parsedEnd(stamp) {
  const parsed = parseDataTimestamp(stamp);
  assert(parsed && !parsed.dateOnly, `timestamp did not parse: ${stamp}`);
  return parsed.end;
}

/* ISO → PT and PT text both floor. 59 seconds stays; second 0 of the next minute does not. */
const isoSeconds = "2026-11-05T20:06:41-08:00";
const isoLate = "2026-11-05T20:06:59-08:00";
const isoNext = "2026-11-05T20:07:00-08:00";
assert(clockToPt(isoSeconds) === "2026-11-05 8:06 PM PT", "ISO path rounded or kept seconds");
assert(clockFromInstant(Date.parse(isoSeconds)) === "2026-11-05 8:06 PM PT", "instant path rounded or kept seconds");
assert(clockToPt("2026-11-05 8:06:41 PM PT") === "2026-11-05 8:06 PM PT", "PT text path rounded or kept seconds");
assert(clockToPt("2026-11-05 20:06:59 PT") === "2026-11-05 8:06 PM PT", "24-hour PT text rounded or kept seconds");
assert(sameEpochMinute(parsedEnd(isoSeconds), parsedEnd(clockToPt(isoSeconds))), "same minute with non-zero seconds should pass");
assert(sameEpochMinute(parsedEnd(isoLate), parsedEnd("2026-11-05 8:06 PM PT")), "59 seconds must stay in the floored minute");
assert(!sameEpochMinute(parsedEnd(isoLate), parsedEnd(isoNext)), "one second into the next minute must fail");
assert(!sameEpochMinute(parsedEnd(isoSeconds), parsedEnd("2026-11-05 8:07 PM PT")), "adjacent minute must fail");
assert(epochMinute(parsedEnd(isoLate)) + 1 === epochMinute(parsedEnd(isoNext)), "floor must land on neighboring minutes");
assert(clockToPt("2026-10-30T09:17:41-07:00") === "2026-10-30 9:17 AM PT", "PDT ISO path");
assert(clockToPt("2026-10-30 9:17:41 AM PT") === "2026-10-30 9:17 AM PT", "PDT text path");
assert(sameEpochMinute(parsedEnd("2026-10-30T09:17:41-07:00"), parsedEnd("2026-10-30 9:17 AM PT")), "PDT same minute");
assert(clockFromInstant(Date.parse("2026-11-06T07:59:59Z")) === "2026-11-05 11:59 PM PT", "date boundary before midnight PT");
assert(clockFromInstant(Date.parse("2026-11-06T08:00:00Z")) === "2026-11-06 12:00 AM PT", "date boundary at midnight PT");
assert(!sameEpochMinute(Date.parse("2026-11-06T07:59:59Z"), Date.parse("2026-11-06T08:00:00Z")), "midnight boundary must fail");
assert(clockToPt("not-a-time") === null, "invalid text should fail");
assert(clockToPt("2026-11-05 0:06 AM PT") === null, "invalid hour should fail");
assert(parseDataTimestamp("2026-11-05 8:06 PM") === null, "missing PT should fail");
assert(parseDataTimestamp("nope") === null, "garbage should fail");
assert(sameEpochMinute(Number.NaN, parsedEnd(isoSeconds)) === false, "invalid epoch should fail");

const scoringNames = (await readdir(join(root, "data"))).filter((name) => /^livescoring-w\d+\.json$/.test(name));
const sourceBefore = new Map();
for (const name of scoringNames) sourceBefore.set(name, await readFile(join(root, "data", name), "utf8"));
const generated = await buildMatchups();
const generatedAgain = await buildMatchups();
assert(JSON.stringify(generated) === JSON.stringify(generatedAgain), "generation is not idempotent");
for (const name of scoringNames) {
  assert((await readFile(join(root, "data", name), "utf8")) === sourceBefore.get(name), `${name} changed`);
}
/* A final week rolls the board to the next week. That shell has no livescoring file until game day.
   Require this week's file when it is on disk, and refuse an older week's file when it is not.
   The minute-floor check still runs: against the file generation used, or against every stored ISO. */
const weekLiveName = `livescoring-w${generated.week}.json`;
const weekLiveRel = `data/${weekLiveName}`;
const cited = (generated.sources || []).filter((item) => /^data\/livescoring-w\d+\.json$/.test(item));
if (sourceBefore.has(weekLiveName)) {
  assert(cited.length === 1 && cited[0] === weekLiveRel, `generation did not use ${weekLiveRel}`);
  if (cited.length === 1 && cited[0] === weekLiveRel) {
    const sourceIso = JSON.parse(sourceBefore.get(weekLiveName)).asOf;
    assert(typeof sourceIso === "string" && sourceIso.includes("T"), "source ISO is missing");
    assert(generated.asOf === clockToPt(sourceIso), "generated clock is not the floored source minute");
    assert(sameEpochMinute(parsedEnd(sourceIso), parsedEnd(generated.asOf)), "generated clock is not the source epoch minute");
  }
} else {
  assert(!cited.length, `pregame week ${generated.week} cited a livescoring file (${cited.join(", ")})`);
  assert(scoringNames.length > 0, "no livescoring file is left to prove the minute floor");
  for (const name of scoringNames) {
    const sourceIso = JSON.parse(sourceBefore.get(name)).asOf;
    const floored = clockToPt(sourceIso);
    assert(typeof sourceIso === "string" && sourceIso.includes("T"), `${name} source ISO is missing`);
    assert(floored, `${name} ISO did not floor`);
    assert(sameEpochMinute(parsedEnd(sourceIso), parsedEnd(floored)), `${name} ISO is not its floored minute`);
    assert(generated.asOf !== floored, `pregame clock adopted stale ${name}`);
  }
}

const live = await readJson("data/matchups-live.json");
const liveWeek = Number(live.week);
const livescoringRel = Number.isFinite(liveWeek) ? `data/livescoring-w${liveWeek}.json` : null;
let livescoring = null;
if (livescoringRel) {
  try {
    livescoring = await readJson(livescoringRel);
  } catch {
    livescoring = null;
  }
}
assert(live.asOf === generated.asOf, `committed asOf ${live.asOf} is not the generated minute clock ${generated.asOf}`);
const timed = parseDataTimestamp(live.asOf);
assert(timed && !timed.dateOnly, `matchups asOf did not parse: ${live.asOf}`);
if (livescoring) {
  const iso = parseDataTimestamp(livescoring.asOf);
  assert(iso && !iso.dateOnly, `livescoring asOf did not parse: ${livescoring.asOf}`);
  assert(sameEpochMinute(iso.end, timed.end), "livescoring ISO and matchups asOf are not the same minute");
}
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

// Historical W8 Friday-morning stamp — stale-rule fixtures must not ride the live week roll.
const fridayMorningAsOf = "2026-10-30 9:17 AM PT";
const fridayOld = evaluateFreshness({ stamp: fridayMorningAsOf, now: friday, missing: false });
assert(!fridayOld.stale && /^updated \d+ min ago$/.test(fridayOld.label), `Friday should keep an age without STALE (${fridayOld.label})`);
const sundayOld = evaluateFreshness({ stamp: fridayMorningAsOf, now: sunday, missing: false });
assert(sundayOld.stale && sundayOld.ageMs > STALE_AFTER_MS, "Sunday afternoon should mark the Friday morning file STALE");

const missingTuesday = evaluateFreshness({ stamp: live.asOf, now: tuesday, missing: true });
const missingSunday = evaluateFreshness({ stamp: null, now: sunday, missing: true });
assert(missingTuesday.stale && missingSunday.stale, "a missing file is STALE inside and outside the window");
assert(missingSunday.label === "", "a missing file with no stamp does not invent an age");

const sameDay = evaluateFreshness({ stamp: "2026-11-01", now: sunday, missing: false });
assert(sameDay.label === "updated today" && !sameDay.stale, "a date-only stamp still on that PT day is not a 45-min stale");

const weekFiles = [];
for (let week = 1; week <= 7; week += 1) weekFiles.push(`data/scores-w${week}-2026.json`);
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
if (livescoring) {
  assert(sources.includes(livescoringRel), "livescoring file is refreshed");
} else {
  assert(
    !sources.some((file) => /livescoring-w\d+\.json$/.test(file)),
    "pregame shell should not list a missing livescoring week file"
  );
}
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

const nojekyll = await stat(join(root, ".nojekyll")).then((info) => info.isFile()).catch(() => false);
assert(nojekyll, ".nojekyll is missing");

const page = await readFile(join(root, "matchups.html"), "utf8");
const pageJs = await readFile(join(root, "js/matchups-page.js"), "utf8");
assert(page.includes('id="updatedAgo"') && page.includes('id="staleRow"'), "matchups.html is missing the freshness line");
assert(pageJs.includes("live-refresh.js") && pageJs.includes("cacheBust"), "matchups page does not refresh");

console.log(`Refresh checks ok (${weekFiles.length} week files)`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s).`);
  process.exit(1);
}
console.log("\nLive refresh check passed.");

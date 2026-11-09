#!/usr/bin/env node
/* Yet-to-play of zero is not a final while a player is in progress. */
import { gameStatus } from "./build-matchups-live.mjs";
import { winProbability } from "../js/live-prob.js";

const failures = [];
function assert(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.error("FAIL", msg);
  }
}

function side(over) {
  return {
    lineupSet: true,
    score: 10,
    projection: 12,
    playersLeft: 0,
    playersDone: 13,
    playersInProgress: 0,
    minutesRemaining: 0,
    ...over
  };
}

function game(a, b, status) {
  return { status: status || "scheduled", sideA: side(a), sideB: side(b) };
}

/* Valley Old Goats vs Mrs. Doubtpfizer, 2026-11-08 7:11 PM PT. Both still playing. */
const goats = game(
  { score: 173.5, projection: 182.86, playersLeft: 0, playersDone: 13, playersInProgress: 1, minutesRemaining: 27 },
  { score: 228.5, projection: 235.04, playersLeft: 0, playersDone: 13, playersInProgress: 1, minutesRemaining: 27 }
);
assert(gameStatus(goats) === "live", `in-progress game was ${gameStatus(goats)}`);
const goatsProb = winProbability({
  scoreA: goats.sideA.score, projA: goats.sideA.projection, leftA: goats.sideA.playersLeft,
  scoreB: goats.sideB.score, projB: goats.sideB.projection, leftB: goats.sideB.playersLeft,
  final: false, inProgressA: 1, inProgressB: 1
});
assert(goatsProb && goatsProb.decided === false, "in-progress game was marked decided");
assert(goatsProb.sideA !== 0 && goatsProb.sideA !== 1, `in-progress bar locked at ${goatsProb && goatsProb.sideA}`);

/* Same counts with nobody in progress is a real final. */
const done = game(
  { score: 173.5, projection: 173.5, playersInProgress: 0, minutesRemaining: 0 },
  { score: 228.5, projection: 228.5, playersInProgress: 0, minutesRemaining: 0 }
);
assert(gameStatus(done) === "final", `completed game was ${gameStatus(done)}`);
const doneProb = winProbability({
  scoreA: done.sideA.score, projA: done.sideA.projection, leftA: 0,
  scoreB: done.sideB.score, projB: done.sideB.projection, leftB: 0,
  final: true, inProgressA: 0, inProgressB: 0
});
assert(doneProb && doneProb.decided === true && doneProb.sideA === 0 && doneProb.sideB === 1, "completed game did not finish 0/100");

/* Unknown in-progress count must not become a final just because yet-to-play is zero. */
const unknown = game(
  { playersInProgress: null },
  { playersInProgress: null }
);
assert(gameStatus(unknown) === "live", `unknown progress was ${gameStatus(unknown)}`);

assert(gameStatus(game({ score: null, projection: null, playersLeft: null, playersInProgress: null }, { score: null, projection: null, playersLeft: null, playersInProgress: null })) === "scheduled", "pregame was not scheduled");
assert(gameStatus(game({ playersLeft: 2, playersInProgress: 1 }, { playersLeft: 1, playersInProgress: 0 })) === "live", "players still to start were not live");
assert(gameStatus({ status: "final", sideA: side({ playersInProgress: 1, playersLeft: 2 }), sideB: side({ playersInProgress: 1, playersLeft: 2 }) }) === "final", "a posted final was reopened");

if (failures.length) {
  console.error(`\n${failures.length} problem(s).`);
  process.exit(1);
}
console.log("Game status checks passed.");

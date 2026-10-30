/* Live-matchup win chance. One formula, used by the page and the builder.
   Normal approximation. Percents are rounded to the nearest 5%. */

export const FORMULA = {
  id: "normal-approx-v1",
  playerSd: 8,
  unknownTeamSd: 18,
  roundTo: 5,
  liveFloor: 5,
  liveCeil: 95,
  text:
    "Win chance is a normal approximation, rounded to the nearest 5%. " +
    "Each club’s projected final already includes points on the board, so points still expected are the projection minus the current score, and never below zero. " +
    "The expected margin is one club’s current score plus the points it still expects, minus the other club’s. " +
    "Each starter still to play is an independent 8-point standard deviation. The two clubs combine as the square root of the sum of squares. " +
    "If the sync did not say how many players are left, a club that still has projected points out uses a flat 18-point stand-in. That stand-in is not a headcount. " +
    "The bar prints the curve’s chance, rounded to the nearest 5%. A game still in progress stays between 5% and 95%. " +
    "A finished game — nobody left, or a posted final — is 100 / 0, or 50 / 50 on a tie, and does not use the curve. " +
    "If either projection is missing, the bar is left blank."
};

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function leftCount(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function round1(n) {
  return Number(n.toFixed(1));
}

function unit(percent) {
  return Number((percent / 100).toFixed(2));
}

/* Abramowitz and Stegun 7.1.26. Enough for a 5% band. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function phi(z) {
  if (z > 8) return 1;
  if (z < -8) return 0;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function decided(scoreA, scoreB) {
  let pctA = 50;
  if (scoreA > scoreB) pctA = 100;
  else if (scoreA < scoreB) pctA = 0;
  return {
    sideA: unit(pctA),
    sideB: unit(100 - pctA),
    mu: round1(scoreA - scoreB),
    sigma: 0,
    decided: true,
    playersLeftKnown: true
  };
}

/* Higher projected total, still inside the live 5–95 band. */
function liveCap(totalA, totalB, playersLeftKnown) {
  let pctA = 50;
  if (totalA > totalB) pctA = FORMULA.liveCeil;
  else if (totalA < totalB) pctA = FORMULA.liveFloor;
  return {
    sideA: unit(pctA),
    sideB: unit(100 - pctA),
    mu: round1(totalA - totalB),
    sigma: 0,
    decided: false,
    playersLeftKnown
  };
}

function sigmaFor(left, remain) {
  if (left === 0) return 0;
  if (left != null && left > 0) return FORMULA.playerSd * Math.sqrt(left);
  if (remain <= 0) return 0;
  return FORMULA.unknownTeamSd;
}

/* scoreA/projA/leftA are the first club on the card (side A). */
export function winProbability(input) {
  const scoreA = num(input && input.scoreA);
  const scoreB = num(input && input.scoreB);
  if (scoreA == null || scoreB == null) return null;
  const leftA = leftCount(input.leftA);
  const leftB = leftCount(input.leftB);
  const unset = input.emptyA === true || input.emptyB === true;
  /* An unset lineup is not a finished game. A 100 / 0 bar would treat "no lineup" as a lock. */
  const finished = !unset && (input.final === true || (leftA === 0 && leftB === 0));
  if (finished) return decided(scoreA, scoreB);

  const projA = num(input.projA);
  const projB = num(input.projB);
  if (projA == null || projB == null) return null;

  const remainA = Math.max(0, projA - scoreA);
  const remainB = Math.max(0, projB - scoreB);
  const mu = (scoreA + remainA) - (scoreB + remainB);
  const sigA = sigmaFor(leftA, remainA);
  const sigB = sigmaFor(leftB, remainB);
  const sigma = Math.sqrt(sigA * sigA + sigB * sigB);
  if (sigma === 0) {
    if (unset) return liveCap(scoreA + remainA, scoreB + remainB, leftA != null && leftB != null);
    return decided(scoreA + remainA, scoreB + remainB);
  }

  const p = phi(mu / sigma);
  let pctA = Math.round(p * (100 / FORMULA.roundTo)) * FORMULA.roundTo;
  if (pctA < FORMULA.liveFloor) pctA = FORMULA.liveFloor;
  if (pctA > FORMULA.liveCeil) pctA = FORMULA.liveCeil;
  return {
    sideA: unit(pctA),
    sideB: unit(100 - pctA),
    mu: round1(mu),
    sigma: round1(sigma),
    decided: false,
    playersLeftKnown: leftA != null && leftB != null
  };
}

export function assertFormula() {
  const featured = winProbability({
    scoreA: 33, projA: 201.1, leftA: null,
    scoreB: 0, projB: 202.8, leftB: null
  });
  if (!featured || featured.sideA !== 0.45 || featured.sideB !== 0.55 || featured.mu !== -1.7 || featured.sigma !== 25.5 || featured.decided !== false || featured.playersLeftKnown !== false) {
    throw new Error("featured fixture was " + JSON.stringify(featured));
  }
  const even = winProbability({ scoreA: 10, projA: 180, leftA: null, scoreB: 10, projB: 180, leftB: null });
  if (!even || even.sideA !== 0.5 || even.sideB !== 0.5) throw new Error("even fixture was " + JSON.stringify(even));
  if (winProbability({ scoreA: 10, projA: null, leftA: 4, scoreB: 10, projB: 180, leftB: 4 }) !== null) {
    throw new Error("missing projection should blank the bar");
  }
  if (winProbability({ scoreA: null, projA: 180, leftA: 4, scoreB: 0, projB: 180, leftB: 4 }) !== null) {
    throw new Error("missing score should blank the bar");
  }
  const locked = winProbability({ scoreA: 10, projA: 10, leftA: 0, scoreB: 3, projB: 3, leftB: 0 });
  if (!locked || locked.sideA !== 1 || locked.sideB !== 0 || locked.decided !== true) {
    throw new Error("finished fixture was " + JSON.stringify(locked));
  }
  const tie = winProbability({ scoreA: 10, leftA: 0, scoreB: 10, leftB: 0, final: true });
  if (!tie || tie.sideA !== 0.5 || tie.decided !== true) throw new Error("tie fixture was " + JSON.stringify(tie));
  const blowout = winProbability({ scoreA: 200, projA: 210, leftA: 1, scoreB: 0, projB: 10, leftB: 1 });
  if (!blowout || blowout.sideA !== 0.95 || blowout.sideB !== 0.05 || blowout.decided !== false) {
    throw new Error("blowout fixture was " + JSON.stringify(blowout));
  }
  const counted = winProbability({ scoreA: 100, projA: 100, leftA: 0, scoreB: 90, projB: 140, leftB: 4 });
  if (!counted || counted.sideA !== 0.05 || counted.playersLeftKnown !== true || counted.sigma !== 16) {
    throw new Error("counted fixture was " + JSON.stringify(counted));
  }
  const unset = winProbability({
    scoreA: 41, projA: 211.49, leftA: 12,
    scoreB: 0, projB: 0, leftB: 0,
    emptyB: true, final: true
  });
  if (!unset || unset.sideA !== 0.95 || unset.sideB !== 0.05 || unset.decided !== false) {
    throw new Error("unset lineup fixture was " + JSON.stringify(unset));
  }
}

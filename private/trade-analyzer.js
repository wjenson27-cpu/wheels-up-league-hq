/* Desk trade check for the featured club. Runs in the browser.
   Rosters supply the depth chart (IDP included). Power rankings supply
   season points. Posted week score files supply logged player points.
   A player with no week log stays blank. Nothing here is a forecast. */

export const OFFENSE = ["QB", "RB", "WR", "TE"];
export const IDP = ["DL", "LB", "DB"];
const SLOT_ORDER = [...OFFENSE, ...IDP, "IR"];

const POS_LABEL = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  RWT: "RWT flex",
  DL: "DL",
  LB: "LB",
  DB: "DB",
  ID: "ID flex",
  IR: "IR"
};

export function playerKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function playerName(entry) {
  if (typeof entry === "string") return entry.trim();
  if (entry && typeof entry === "object" && typeof entry.name === "string") return entry.name.trim();
  return "";
}

export function clubName(id, rosterName, featured) {
  if (id === "eddies") return featured;
  if (id === "ttab") return "TTAB";
  return rosterName || id;
}

export function lineupFromScoring(data) {
  const raw = data && data.roster && data.roster.startingLineup;
  if (!raw) return null;
  const num = (key) => {
    const n = Number(raw[key]);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const lineup = {
    QB: num("QB"),
    RB: num("RB"),
    WR: num("WR"),
    TE: num("TE"),
    RWT: num("RWT_flex_RB_WR_TE"),
    DL: num("DL"),
    LB: num("LB"),
    DB: num("DB"),
    ID: num("ID_flex_any_IDP")
  };
  if (Object.values(lineup).some((n) => n == null)) return null;
  return lineup;
}

export function rosterPlayers(roster) {
  const chart = roster && roster.roster;
  if (!chart || typeof chart !== "object") return [];
  const irNames = new Set(
    (Array.isArray(chart.IR) ? chart.IR : []).map((entry) => playerKey(playerName(entry))).filter(Boolean)
  );
  const keys = SLOT_ORDER.filter((pos) => Array.isArray(chart[pos]));
  const extra = Object.keys(chart).filter((pos) => !SLOT_ORDER.includes(pos) && /^[A-Z]{1,4}$/.test(pos) && Array.isArray(chart[pos]));
  const players = [];
  const seen = new Set();
  for (const pos of [...keys, ...extra]) {
    for (const entry of chart[pos]) {
      const name = playerName(entry);
      const key = playerKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const ir = pos === "IR" || irNames.has(key);
      players.push({ name, key, pos: ir ? "IR" : pos, ir });
    }
  }
  return players;
}

export function activeCounts(players) {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, DL: 0, LB: 0, DB: 0 };
  for (const player of players) {
    if (player.ir || counts[player.pos] == null) continue;
    counts[player.pos] += 1;
  }
  return counts;
}

export function depthReport(counts, lineup) {
  const have = {};
  for (const pos of [...OFFENSE, ...IDP]) have[pos] = Math.max(0, Number(counts[pos]) || 0);
  const remain = {};
  const holes = [];
  let dedicatedFilled = 0;
  for (const pos of [...OFFENSE, ...IDP]) {
    const need = lineup[pos];
    const got = Math.min(have[pos], need);
    dedicatedFilled += got;
    remain[pos] = have[pos] - got;
    if (got < need) holes.push({ pos, short: need - got, group: IDP.includes(pos) ? "IDP" : "offense" });
  }
  const rwtPool = remain.RB + remain.WR + remain.TE;
  const rwtFilled = Math.min(lineup.RWT, rwtPool);
  if (rwtFilled < lineup.RWT) holes.push({ pos: "RWT", short: lineup.RWT - rwtFilled, group: "offense" });
  const idPool = remain.DL + remain.LB + remain.DB;
  const idFilled = Math.min(lineup.ID, idPool);
  if (idFilled < lineup.ID) holes.push({ pos: "ID", short: lineup.ID - idFilled, group: "IDP" });
  const starterNeed = [...OFFENSE, ...IDP].reduce((sum, pos) => sum + lineup[pos], 0) + lineup.RWT + lineup.ID;
  return {
    have,
    holes,
    starters: dedicatedFilled + rwtFilled + idFilled,
    starterNeed,
    bench: (rwtPool - rwtFilled) + (idPool - idFilled)
  };
}

export function applyDeal(players, sendKeys, receivePlayers) {
  const drop = new Set(sendKeys);
  const next = players.filter((player) => !drop.has(player.key)).map((player) => ({ ...player }));
  const have = new Set(next.map((player) => player.key));
  for (const player of receivePlayers) {
    if (!player || have.has(player.key)) continue;
    next.push({ ...player });
    have.add(player.key);
  }
  return next;
}

export function addWeekLogs(store, file) {
  if (!file || !Array.isArray(file.matchups)) return store;
  const week = Number(file.week);
  if (!Number.isInteger(week)) return store;
  for (const game of file.matchups) {
    for (const row of (game && game.topScorers) || []) {
      const key = playerKey(row && row.player);
      const pts = Number(row && row.pts);
      if (!key || !Number.isFinite(pts)) continue;
      if (!store.has(key)) store.set(key, new Map());
      const weeks = store.get(key);
      if (!weeks.has(week)) weeks.set(week, pts);
    }
  }
  return store;
}

export function loggedTotal(store, key) {
  const weeks = store.get(key);
  if (!weeks || !weeks.size) return null;
  let sum = 0;
  for (const pts of weeks.values()) sum += pts;
  return sum;
}

export function dealPoints(store, players) {
  let knownSum = 0;
  let known = 0;
  let missing = 0;
  const rows = players.map((player) => {
    const pts = loggedTotal(store, player.key);
    if (pts == null) missing += 1;
    else {
      known += 1;
      knownSum += pts;
    }
    return { name: player.name, pos: player.pos, ir: player.ir, pts };
  });
  return {
    rows,
    known,
    missing,
    knownSum: known ? knownSum : null,
    sum: missing || !known ? null : knownSum
  };
}

export function depthEdge(beforeA, afterA, beforeB, afterB) {
  const startersA = afterA.starters - beforeA.starters;
  const startersB = afterB.starters - beforeB.starters;
  const benchA = afterA.bench - beforeA.bench;
  const benchB = afterB.bench - beforeB.bench;
  const netStarters = startersA - startersB;
  let side = "even";
  if (netStarters > 0) side = "a";
  else if (netStarters < 0) side = "b";
  else if (benchA - benchB > 0) side = "a";
  else if (benchA - benchB < 0) side = "b";
  return { startersA, startersB, benchA, benchB, netStarters, side };
}

export function pointsEdge(pointsA, pointsB) {
  if (!pointsA || !pointsB || pointsA.sum == null || pointsB.sum == null) {
    return { side: "unknown", diff: null };
  }
  const diff = pointsA.sum - pointsB.sum;
  if (diff > 0.05) return { side: "a", diff };
  if (diff < -0.05) return { side: "b", diff: -diff };
  return { side: "even", diff: 0 };
}

export function formatPts(n) {
  if (!Number.isFinite(Number(n))) return "—";
  const rounded = Math.round(Number(n) * 10) / 10;
  return String(rounded);
}

function featuredName() {
  const cfg = typeof window !== "undefined" ? window.WUC_CONFIG : null;
  return (cfg && cfg.featuredTeam) || "Eagleridge Eddie's";
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeId(id) {
  return /^[a-z0-9-]{1,40}$/.test(String(id || "")) ? String(id) : "";
}

function safeColor(value) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value || "")) ? String(value) : "#69BE28";
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function loadLogs() {
  const store = new Map();
  let latest = null;
  try {
    latest = await fetchJson("../data/scores.json");
  } catch (_) {
    latest = null;
  }
  const through = latest && Number.isInteger(Number(latest.week)) ? Number(latest.week) : 0;
  for (let week = 1; week <= through; week += 1) {
    try {
      addWeekLogs(store, await fetchJson(`../data/scores-w${week}-2026.json`));
    } catch (_) {
      /* A missing week file adds no points. */
    }
  }
  if (latest) addWeekLogs(store, latest);
  return store;
}

function rankIndex(rankings) {
  const map = new Map();
  if (!rankings || rankings.pendingPublish === true) return map;
  for (const row of rankings.rankings || []) {
    if (!row || row.pendingPublish === true || !row.teamId) continue;
    map.set(row.teamId, {
      rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : null,
      pf: Number.isFinite(Number(row.pf)) ? Number(row.pf) : null
    });
  }
  return map;
}

function colorIndex(teamsFile) {
  const map = new Map();
  for (const team of (teamsFile && teamsFile.teams) || []) {
    if (!team || !team.id) continue;
    map.set(team.id, {
      color: safeColor(team.color),
      abbrev: typeof team.abbrev === "string" ? team.abbrev : team.id
    });
  }
  return map;
}

function holeText(hole) {
  const label = POS_LABEL[hole.pos] || hole.pos;
  return `Short ${hole.short} ${label}`;
}

function seasonLine(team) {
  if (team.rank == null && team.pf == null) return "Season points are not on the published board.";
  const bits = [];
  if (team.rank != null) bits.push(`Power #${team.rank}`);
  if (team.pf != null) bits.push(`${formatPts(team.pf)} season points`);
  return `${bits.join(" · ")}. From the power rankings file. It does not move with this deal.`;
}

function depthSentence(edge, nameA, nameB) {
  if (edge.netStarters === 0 && edge.side === "even") return "Starter slots and bench depth are about even.";
  if (edge.netStarters === 0) {
    const name = edge.side === "a" ? nameA : nameB;
    return `Starter slots are even. Bench depth favors ${name}.`;
  }
  const name = edge.side === "a" ? nameA : nameB;
  return `Depth favors ${name}.`;
}

function pointsSentence(edge, nameA, nameB) {
  if (edge.side === "unknown") return "No points edge. A player in the deal has no week log, so the logged total is incomplete. These are week logs, not a forecast.";
  if (edge.side === "even") return "Logged points are even. These are week logs, not a forecast.";
  const name = edge.side === "a" ? nameA : nameB;
  return `Logged points favor ${name} by ${formatPts(edge.diff)}. These are week logs, not a forecast.`;
}

function depthTable(before, after) {
  const rows = [...OFFENSE, ...IDP].map((pos) => {
    const now = before.have[pos];
    const later = after.have[pos];
    const changed = later !== now ? " is-changed" : "";
    return `<tr class="${changed.trim()}">
      <th scope="row">${esc(pos)}</th>
      <td>${now}</td>
      <td>${later}</td>
    </tr>`;
  }).join("");
  const holes = after.holes.length
    ? after.holes.map((hole) => `<li>${esc(holeText(hole))}</li>`).join("")
    : "<li>No hole in the starting lineup.</li>";
  return `<table class="ta-table">
    <thead><tr><th scope="col">Pos</th><th scope="col">Now</th><th scope="col">After</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="ta-starters">${before.starters}/${before.starterNeed} starters → ${after.starters}/${after.starterNeed}. Bench ${before.bench} → ${after.bench}.</p>
  <ul class="ta-holes">${holes}</ul>`;
}

function pointRows(packet) {
  if (!packet.rows.length) return `<p class="ta-empty">No players marked.</p>`;
  return `<ul class="ta-points">${packet.rows.map((row) => {
    const logged = row.pts == null ? "no week log" : `${formatPts(row.pts)} logged`;
    const tag = row.ir ? " · IR" : "";
    return `<li><span>${esc(row.name)}</span> <span class="ta-pos">${esc(row.pos)}${tag}</span> <strong>${esc(logged)}</strong></li>`;
  }).join("")}</ul>`;
}

function meterBar(edge, colorA, colorB) {
  const net = Math.max(-4, Math.min(4, edge.netStarters));
  const widthA = 50 + net * 10;
  const widthB = 100 - widthA;
  return `<div class="ta-meter" role="img" aria-label="Depth meter">
    <span style="width:${widthA}%;background:${esc(colorA)}"></span>
    <span style="width:${widthB}%;background:${esc(colorB)}"></span>
  </div>`;
}

const state = {
  teams: [],
  lineup: null,
  logs: new Map(),
  featured: "Eagleridge Eddie's",
  sideA: "eddies",
  sideB: "ultron",
  pickA: new Set(),
  pickB: new Set()
};

function teamById(id) {
  return state.teams.find((team) => team.id === id) || null;
}

function render() {
  const root = document.getElementById("taApp");
  if (!root) return;
  root.removeAttribute("aria-busy");
  const teamA = teamById(state.sideA);
  const teamB = teamById(state.sideB);
  if (!state.lineup || !teamA || !teamB) {
    root.innerHTML = `<div class="soft-error">Roster or lineup files are unavailable. No depth or points were filled in.</div>`;
    return;
  }
  const same = teamA.id === teamB.id;
  const markedA = teamA.players.filter((player) => state.pickA.has(player.key));
  const markedB = teamB.players.filter((player) => state.pickB.has(player.key));
  const afterPlayersA = same ? teamA.players : applyDeal(teamA.players, state.pickA, markedB);
  const afterPlayersB = same ? teamB.players : applyDeal(teamB.players, state.pickB, markedA);
  const beforeA = depthReport(activeCounts(teamA.players), state.lineup);
  const beforeB = depthReport(activeCounts(teamB.players), state.lineup);
  const afterA = depthReport(activeCounts(afterPlayersA), state.lineup);
  const afterB = depthReport(activeCounts(afterPlayersB), state.lineup);
  const edge = depthEdge(beforeA, afterA, beforeB, afterB);
  const ptsA = dealPoints(state.logs, markedA);
  const ptsB = dealPoints(state.logs, markedB);
  const pEdge = pointsEdge(ptsA, ptsB);
  const options = state.teams.map((team) => `<option value="${esc(team.id)}">${esc(team.name)}</option>`).join("");
  const lists = same
    ? `<p class="ta-note">Pick two different clubs.</p>`
    : `<div class="ta-grid">
        ${playerColumn(teamA, state.pickA, "a")}
        ${playerColumn(teamB, state.pickB, "b")}
      </div>`;
  const dealOpen = !same && (markedA.length || markedB.length);
  const summary = same
    ? "Pick two different clubs to see depth and logged points."
    : dealOpen
      ? `${depthSentence(edge, teamA.name, teamB.name)} ${pointsSentence(pEdge, teamA.name, teamB.name)}`
      : "Mark the players moving each way. The tables are the current depth charts, offense and IDP.";
  root.innerHTML = `
    <div class="ta-picks">
      <label>Sends <select id="taSideA" data-side="a">${options}</select></label>
      <label>Receives from <select id="taSideB" data-side="b">${options}</select></label>
    </div>
    <section class="card ta-result" id="taResult">
      <h2>This deal</h2>
      <p class="ta-summary">${esc(summary)}</p>
      ${dealOpen ? meterBar(edge, teamA.color, teamB.color) : ""}
      <div class="ta-grid">
        ${sideCard(teamA, beforeA, afterA, ptsA)}
        ${sideCard(teamB, beforeB, afterB, ptsB)}
      </div>
      <p class="ta-note">IDP starters are DL, LB, and DB, plus the ID flex. RWT flex is RB, WR, and TE. IR is not active depth. Logged points come from the posted week score files and only where that player was listed. A blank log is not zero.</p>
    </section>
    ${lists}`;
  const selA = document.getElementById("taSideA");
  const selB = document.getElementById("taSideB");
  if (selA) selA.value = teamA.id;
  if (selB) selB.value = teamB.id;
}

function sideCard(team, before, after, packet) {
  const logo = safeId(team.id) ? `<img class="team-logo" src="../img/logos/${esc(team.id)}.jpg" alt="" width="36" height="36" />` : "";
  return `<article class="ta-side" data-team="${esc(team.id)}">
    <h3><span class="team-mark team-mark-sm" style="--team-color:${esc(team.color)}">${logo}</span> ${esc(team.name)}</h3>
    <p class="ta-season">${esc(seasonLine(team))}</p>
    <div data-depth="${esc(team.id)}">${depthTable(before, after)}</div>
    <h4>Players in the deal</h4>
    <div data-points="${esc(team.id)}">${pointRows(packet)}</div>
  </article>`;
}

function playerColumn(team, picks, side) {
  const groups = [];
  let shownIdp = false;
  for (const pos of SLOT_ORDER) {
    const players = team.players.filter((player) => (player.ir ? "IR" : player.pos) === pos);
    if (!players.length) continue;
    if (IDP.includes(pos) && !shownIdp) {
      groups.push(`<p class="pos-label" data-group="idp">IDP</p>`);
      shownIdp = true;
    }
    const boxes = players.map((player) => {
      const checked = picks.has(player.key) ? " checked" : "";
      return `<label class="ta-player">
        <input type="checkbox" data-side="${side}" data-key="${esc(player.key)}"${checked} />
        <span>${esc(player.name)}</span>
        <span class="ta-pos">${esc(player.ir ? "IR" : player.pos)}</span>
      </label>`;
    }).join("");
    groups.push(`<div class="pos-block"><div class="pos-label">${esc(POS_LABEL[pos] || pos)}</div>${boxes}</div>`);
  }
  return `<section class="card ta-roster" data-roster="${esc(team.id)}">
    <h3>${esc(team.name)}</h3>
    ${groups.join("")}
  </section>`;
}

function onChange(ev) {
  const select = ev.target.closest("select");
  if (select) {
    const side = select.getAttribute("data-side");
    if (side === "a") {
      state.sideA = select.value;
      state.pickA = new Set();
    } else {
      state.sideB = select.value;
      state.pickB = new Set();
    }
    render();
    return;
  }
  const box = ev.target.closest("input[type='checkbox']");
  if (!box) return;
  const key = box.getAttribute("data-key");
  const set = box.getAttribute("data-side") === "a" ? state.pickA : state.pickB;
  if (box.checked) set.add(key);
  else set.delete(key);
  render();
}

async function startAnalyzer() {
  state.featured = featuredName();
  const lede = document.getElementById("taLede");
  if (lede) {
    lede.textContent = `Desk copy for ${state.featured}. Pick two clubs and the players moving each way. Depth includes IDP. Points are logged week totals only. This page is not on the public league site.`;
  }
  const root = document.getElementById("taApp");
  try {
    const [index, rankings, scoring, teamsFile, logs] = await Promise.all([
      fetchJson("../data/rosters/index.json"),
      fetchJson("../data/rankings.json"),
      fetchJson("../data/scoring.json"),
      fetchJson("../data/teams.json"),
      loadLogs()
    ]);
    state.lineup = lineupFromScoring(scoring);
    state.logs = logs;
    const ranks = rankIndex(rankings);
    const colors = colorIndex(teamsFile);
    const ids = Array.isArray(index.teams) ? index.teams : [];
    const teams = [];
    for (const id of ids) {
      if (!safeId(id)) continue;
      const roster = await fetchJson(`../data/rosters/${id}.json`);
      const meta = colors.get(id) || { color: "#69BE28", abbrev: id };
      const rank = ranks.get(id) || { rank: null, pf: null };
      teams.push({
        id,
        name: clubName(id, roster.teamName, state.featured),
        color: meta.color,
        abbrev: meta.abbrev,
        rank: rank.rank,
        pf: rank.pf,
        players: rosterPlayers(roster)
      });
    }
    state.teams = teams;
    if (!teams.some((team) => team.id === state.sideA) && teams[0]) state.sideA = teams[0].id;
    if (!teams.some((team) => team.id === state.sideB)) {
      state.sideB = (teams.find((team) => team.id !== state.sideA) || teams[0] || {}).id || state.sideA;
    }
    render();
  } catch (err) {
    console.error(err);
    if (root) root.innerHTML = `<div class="soft-error">Roster or ranking files are unavailable. No depth or points were filled in.</div>`;
  }
}

if (typeof document !== "undefined") {
  const app = document.getElementById("taApp");
  if (app) app.addEventListener("change", onChange);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startAnalyzer);
  else startAnalyzer();
}

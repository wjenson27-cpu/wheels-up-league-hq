/* Live Matchups page. Reads data/matchups-live.json only. */
import { FORMULA } from "./live-prob.js";

const esc = (s) => (window.WUC && WUC.escapeHtml ? WUC.escapeHtml(s) : String(s ?? ""));

function safeColor(value) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value || "")) ? String(value) : "#69BE28";
}

function safeId(value) {
  return /^[a-z0-9-]{1,40}$/.test(String(value || "")) ? String(value) : "";
}

function publicName(side) {
  if (!side) return "—";
  if (side.teamId === "ttab") return "TTAB";
  return side.name || "—";
}

function pts(n) {
  if (n == null || n === "" || !Number.isFinite(Number(n))) return "—";
  return WUC.formatPts(n);
}

function leftText(n) {
  if (n == null || n === "") return "Players left —";
  const count = Number(n);
  return count === 1 ? "1 player left" : `${count} players left`;
}

function pctText(unit) {
  return `${Math.round(Number(unit) * 100)}%`;
}

function signed(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const body = Math.abs(x).toFixed(1).replace(/\.0$/, "");
  if (x > 0) return `+${body}`;
  if (x < 0) return `−${body}`;
  return body;
}

function statusLabel(status) {
  if (status === "final") return "FINAL";
  if (status === "live") return "LIVE";
  return "NOT POSTED";
}

function teamRow(side) {
  const id = safeId(side.teamId);
  const name = publicName(side);
  const color = safeColor(side.color);
  const logo = id ? `img/logos/${id}.jpg` : "";
  const mark = logo
    ? `<span class="team-mark team-mark-md" style="--team-color:${color}"><img class="team-logo" src="${esc(logo)}" alt="" width="40" height="40" /></span>`
    : "";
  const rec = side.record ? ` · ${esc(side.record)}` : "";
  const inner = `<span class="team-inline">${mark}<span>${esc(name)}</span></span>`;
  const who = id ? `<a class="team-link" href="team.html?id=${encodeURIComponent(id)}">${inner}</a>` : inner;
  return `<div class="live-side">
    <div class="live-who">${who}</div>
    <div class="live-score" style="color:${color}">${esc(pts(side.score))}</div>
    <p class="live-meta">Proj ${esc(pts(side.projection))} · ${esc(leftText(side.playersLeft))}${rec}</p>
  </div>`;
}

function winBar(game) {
  const prob = game.winProb;
  const nameA = publicName(game.sideA);
  const nameB = publicName(game.sideB);
  if (!prob) {
    return `<div class="winbar winbar-empty" role="img" aria-label="Win chance not posted for ${esc(nameA)} and ${esc(nameB)}"></div>
      <p class="live-nowin">Win % needs both projections.</p>`;
  }
  const a = pctText(prob.sideA);
  const b = pctText(prob.sideB);
  const colorA = safeColor(game.sideA.color);
  const colorB = safeColor(game.sideB.color);
  const spread = prob.decided
    ? "Posted result. The curve is not used once the game is finished."
    : `Expected margin for ${nameA}: ${signed(prob.mu)} · spread ${Number(prob.sigma).toFixed(1)}.${prob.playersLeftKnown ? "" : " Players left were not in the sync, so each club still out uses the 18-point stand-in."}`;
  return `<div class="winbar-head">
      <span style="color:${colorA}">${esc(nameA)} ${esc(a)}</span>
      <span style="color:${colorB}">${esc(b)} ${esc(nameB)}</span>
    </div>
    <div class="winbar" role="img" aria-label="${esc(nameA)} ${esc(a)}, ${esc(nameB)} ${esc(b)}">
      <span style="width:${esc(a)};background:${colorA}"></span>
      <span style="width:${esc(b)};background:${colorB}"></span>
    </div>
    <p class="live-spread">${esc(spread)}</p>`;
}

function card(game) {
  const featured = game.featured === true;
  const nameA = publicName(game.sideA);
  const nameB = publicName(game.sideB);
  const place = game.place === "at" ? "at" : "vs";
  const ids = [game.sideA && game.sideA.teamId, game.sideB && game.sideB.teamId];
  const eddiesUltron = ids.includes("eddies") && ids.includes("ultron");
  const title = featured && eddiesUltron ? `<h2>The Eddies vs Ultron</h2>` : "";
  const tag = statusLabel(game.status);
  return `<article class="card live-card${featured ? " is-featured" : ""}" data-matchup="${esc(game.id || "")}" data-featured="${featured ? "yes" : "no"}">
    <div class="live-kicker">
      <span class="live-tag is-${esc(game.status || "scheduled")}">${tag}</span>
      ${featured ? `<span class="live-feature">Featured</span>` : ""}
    </div>
    ${title}
    ${teamRow(game.sideA)}
    <p class="live-vs">${place}</p>
    ${teamRow(game.sideB)}
    ${winBar(game)}
  </article>`;
}

function render(data) {
  const board = document.getElementById("liveBoard");
  const games = (data && data.matchups) || [];
  const week = data.week || "—";
  const windowLabel = data.windowLabel || "";
  const eyebrow = document.getElementById("liveEyebrow");
  if (eyebrow) eyebrow.textContent = `Week ${week} · ${windowLabel}`.replace(/\s+·\s+$/, "");
  const lede = document.getElementById("liveLede");
  if (lede) {
    lede.textContent = `Week ${week}, ${windowLabel}, PT. Current score, projected final, and starters still to play. A dash means that number was not in the sync yet. The bar is a normal approximation, rounded to the nearest 5%.`;
  }
  const asOf = document.getElementById("asOf");
  const stamp = data.asOf || "—";
  if (asOf) asOf.textContent = `as of ${stamp}`;
  const formula = (data.formula && data.formula.text) || FORMULA.text;
  const cards = games.map(card).join("");
  board.removeAttribute("aria-busy");
  board.innerHTML = `${cards}
    <section class="card live-formula" id="formulaCard">
      <h2>How the win chance is calculated</h2>
      <p id="formulaText">${esc(formula)}</p>
      <p class="live-formula-meta">Model ${esc((data.formula && data.formula.id) || FORMULA.id)}. ${FORMULA.playerSd} points per starter still out. ${FORMULA.unknownTeamSd}-point stand-in when the headcount is missing. Nearest ${FORMULA.roundTo}%.</p>
    </section>`;
}

async function start() {
  const board = document.getElementById("liveBoard");
  try {
    const res = await fetch("data/matchups-live.json");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    render(data);
  } catch (err) {
    console.error(err);
    if (!board) return;
    board.removeAttribute("aria-busy");
    board.innerHTML = `<div class="soft-error">Live matchups are unavailable.<br/><button type="button" class="btn btn-ghost" data-retry="1">Refresh</button></div>`;
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

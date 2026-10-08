/* Shared league data helpers. Reads the existing data/*.json files.
   Pending FAAB bids and pending trade offers are never rendered. */
(function () {
  const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "LB", "DL", "DB", "FLEX", "IDP", "IR"];
  const ALIAS_TO_ID = {
    "greenacres goblins": "hyper",
    hypersecretors: "hyper",
    "the hypersecretors": "hyper",
    hyper: "hyper",
    "towner top aga bottom": "ttab",
    ttab: "ttab",
    tta: "ttab",
    "pocket agents": "pocket",
    pocket: "pocket",
    substation: "substation",
    sub: "substation",
    ultron: "ultron",
    "saltese slamm": "saltese",
    saltese: "saltese",
    "eagle ridge eddies": "eddies",
    eddies: "eddies",
    "indian trail slumlords": "slumlords",
    slumlords: "slumlords",
    "mrs doubtpfizer": "doubtpfizer",
    doubtpfizer: "doubtpfizer",
    "drummond dongers": "dongers",
    dongers: "dongers",
    "morningside muff divers": "morningside",
    morningside: "morningside",
    divers: "morningside",
    "newman lake sleep paralysis demons": "newman",
    newman: "newman",
    demons: "newman",
    "little ass boys": "lab",
    lab: "lab",
    "valley old goats": "goats",
    goats: "goats",
    "old goats": "goats"
  };

  let teamIndex = null;

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function indexTeams(teams) {
    teamIndex = Array.isArray(teams) ? teams : [];
    return teamIndex;
  }

  function allTeams() {
    if (teamIndex && teamIndex.length) return teamIndex;
    const colors = (window.WUC && WUC.teamColors) || {};
    return Object.values(colors);
  }

  function safeId(id) {
    const s = String(id || "").toLowerCase();
    return /^[a-z0-9-]{1,40}$/.test(s) ? s : "";
  }

  function resolveTeamId(label) {
    const teams = allTeams();
    const raw = String(label || "").trim();
    if (!raw) return null;
    if (teams.some((t) => t.id === raw)) return raw;
    const n = norm(raw);
    if (!n) return null;
    if (ALIAS_TO_ID[n]) return ALIAS_TO_ID[n];
    for (const t of teams) {
      if (norm(t.name) === n) return t.id;
      if (t.shortName && norm(t.shortName) === n) return t.id;
      if (t.short && norm(t.short) === n) return t.id;
      if (t.abbrev && norm(t.abbrev) === n) return t.id;
    }
    const hits = teams.filter((t) => {
      const tn = norm(t.name);
      return tn && (tn.includes(n) || n.includes(tn)) && Math.min(tn.length, n.length) >= 4;
    });
    return hits.length === 1 ? hits[0].id : null;
  }

  function teamById(id) {
    return allTeams().find((t) => t.id === id) || (window.WUC && WUC.getTeam ? WUC.getTeam(id) : {}) || {};
  }

  function teamHref(id) {
    return "team.html?id=" + encodeURIComponent(id);
  }

  function teamLinkHtml(labelOrId, opts) {
    const optsSafe = opts || {};
    const id = resolveTeamId(labelOrId);
    const team = id ? teamById(id) : {};
    const text = optsSafe.text != null ? optsSafe.text : (team.shortName || team.name || labelOrId || "—");
    const mark = window.WUC && WUC.teamMark
      ? WUC.teamMark(id || labelOrId, { size: optsSafe.size || "sm" })
      : "";
    const inner = `<span class="team-inline">${mark}<span>${WUC.escapeHtml(text)}</span></span>`;
    if (!id) return inner;
    return `<a class="team-link" href="${teamHref(id)}">${inner}</a>`;
  }

  async function loadOptional(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  function formatPts(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return x.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }

  function formatDiff(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    const body = formatPts(Math.abs(x));
    if (x > 0) return "+" + body;
    if (x < 0) return "−" + body;
    return body;
  }

  function pointsFor(team) {
    if (!team) return null;
    const n = team.pointsFor != null ? team.pointsFor : (team.pf != null ? team.pf : team.fpts);
    return n == null || n === "" ? null : Number(n);
  }

  function pointsAgainst(team) {
    if (!team) return null;
    const n = team.pointsAgainst != null ? team.pointsAgainst : team.pa;
    return n == null || n === "" ? null : Number(n);
  }

  function recordLabel(team) {
    if (!team) return "—";
    if (team.wins != null || team.losses != null) {
      const w = Number(team.wins) || 0;
      const l = Number(team.losses) || 0;
      const t = Number(team.ties) || 0;
      return t ? `${w}-${l}-${t}` : `${w}-${l}`;
    }
    const raw = String(team.record || "—");
    return raw.endsWith("-0") ? raw.slice(0, -2) : raw;
  }

  function sortStandings(teams, mode) {
    const list = [...(teams || [])];
    if (mode === "pf") {
      list.sort((a, b) => (pointsFor(b) || 0) - (pointsFor(a) || 0) || String(a.name).localeCompare(String(b.name)));
      return list;
    }
    if (mode === "pa") {
      list.sort((a, b) => (pointsAgainst(a) || 0) - (pointsAgainst(b) || 0) || String(a.name).localeCompare(String(b.name)));
      return list;
    }
    const ranked = list.length > 0 && list.every((t) => t.standingsRank != null && t.standingsRank !== "");
    if (ranked) {
      list.sort((a, b) => Number(a.standingsRank) - Number(b.standingsRank));
      return list;
    }
    list.sort((a, b) => {
      const bw = (Number(b.wins) || 0) - (Number(a.wins) || 0);
      if (bw) return bw;
      const losses = (Number(a.losses) || 0) - (Number(b.losses) || 0);
      if (losses) return losses;
      const ties = (Number(b.ties) || 0) - (Number(a.ties) || 0);
      if (ties) return ties;
      const pf = (pointsFor(b) || 0) - (pointsFor(a) || 0);
      if (pf) return pf;
      return String(a.name).localeCompare(String(b.name));
    });
    return list;
  }

  function pendingBag(obj) {
    if (!obj || typeof obj !== "object") return "";
    return [obj.status, obj.state, obj.kind, obj.type].filter(Boolean).join(" ").toLowerCase();
  }

  function isPendingish(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (obj.pending === true || obj.settled === false || obj.processed === false) return true;
    return /pending|upcoming|proposed|unprocessed|offer/.test(pendingBag(obj));
  }

  function isPublicClaim(claim) {
    if (!claim || typeof claim !== "object") return false;
    if (isPendingish(claim)) return false;
    const kind = String(claim.kind || "claim").toLowerCase();
    if (kind === "bid" || kind === "offer") return false;
    return true;
  }

  function publicClaims(list) {
    return (list || []).filter(isPublicClaim);
  }

  function completedTrades(data) {
    const list = (data && data.trades) || [];
    return list.filter((t) => {
      if (!t || typeof t !== "object") return false;
      if (isPendingish(t)) return false;
      const status = String(t.status || "completed").toLowerCase();
      return status === "completed" || status === "complete" || status === "final";
    });
  }

  function publicTransactions(items) {
    return (items || []).filter((t) => t && !isPendingish(t));
  }

  function publicFaabTrades(list) {
    return (list || []).filter((t) => t && !isPendingish(t) && String(t.kind || "trade").toLowerCase() !== "bid");
  }

  function weekIsFinal(week) {
    if (!week) return false;
    if (String(week.weekStatus || "").toLowerCase() === "final") return true;
    if (week.complete === true) return true;
    const ms = week.matchups || [];
    return ms.length > 0 && ms.every((m) => String(m.status || "").toLowerCase() === "final");
  }

  async function loadSeasonWeeks() {
    const current = await loadOptional("data/scores.json");
    const season = (current && current.season) || (window.WUC_CONFIG && WUC_CONFIG.season) || 2026;
    const currentWeek = Number(current && current.week) || 0;
    const map = new Map();
    const add = (data, fallbackWeek) => {
      if (!data || !Array.isArray(data.matchups) || !data.matchups.length) return;
      const w = Number(data.week) || fallbackWeek;
      if (!w) return;
      if (!map.has(w)) map.set(w, Object.assign({ week: w }, data));
    };
    add(current, currentWeek);
    const lastArchive = currentWeek > 1 ? currentWeek - 1 : 0;
    const jobs = [];
    for (let w = 1; w <= lastArchive && w <= 18; w++) {
      jobs.push(loadOptional(`data/scores-w${w}-${season}.json`).then((d) => add(d, w)));
    }
    await Promise.all(jobs);
    return [...map.values()].sort((a, b) => Number(a.week) - Number(b.week));
  }

  function gamesForTeam(teamId, weeks) {
    const games = [];
    for (const week of weeks || []) {
      const final = weekIsFinal(week);
      for (const m of week.matchups || []) {
        const homeId = resolveTeamId(m.home);
        const awayId = resolveTeamId(m.away);
        let side = null;
        if (homeId === teamId) side = "home";
        else if (awayId === teamId) side = "away";
        else continue;
        const score = Number(side === "home" ? m.homeScore : m.awayScore);
        const oppScore = Number(side === "home" ? m.awayScore : m.homeScore);
        const oppId = side === "home" ? awayId : homeId;
        const oppName = side === "home" ? m.away : m.home;
        let result = null;
        if (final && Number.isFinite(score) && Number.isFinite(oppScore)) {
          result = score > oppScore ? "W" : score < oppScore ? "L" : "T";
        }
        games.push({
          week: Number(week.week),
          final,
          score,
          oppScore,
          oppId,
          oppName,
          result,
          side,
          status: m.status || week.weekStatus || ""
        });
      }
    }
    games.sort((a, b) => a.week - b.week);
    return games;
  }

  function streakFromLog(games, team) {
    const finals = (games || []).filter((g) => g.final && g.result);
    const played = (Number(team && team.wins) || 0) + (Number(team && team.losses) || 0) + (Number(team && team.ties) || 0);
    if (!finals.length || (played && finals.length !== played)) return null;
    const last = finals[finals.length - 1].result;
    let n = 0;
    for (let i = finals.length - 1; i >= 0; i--) {
      if (finals[i].result !== last) break;
      n += 1;
    }
    return `${last}${n}`;
  }

  function weeksAreComplete(weeks) {
    const nums = (weeks || []).filter(weekIsFinal).map((w) => Number(w.week)).sort((a, b) => a - b);
    if (!nums.length) return { ok: false, max: 0, nums };
    const max = nums[nums.length - 1];
    const ok = nums[0] === 1 && nums.length === max && nums.every((n, i) => n === i + 1);
    return { ok, max, nums };
  }

  function seasonHighlights(weeks) {
    const cover = weeksAreComplete(weeks);
    let high = null;
    let low = null;
    let margin = null;
    for (const week of (weeks || []).filter(weekIsFinal)) {
      for (const m of week.matchups || []) {
        const hs = Number(m.homeScore);
        const as = Number(m.awayScore);
        if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
        const sides = [
          { name: m.home, id: resolveTeamId(m.home), score: hs },
          { name: m.away, id: resolveTeamId(m.away), score: as }
        ];
        for (const s of sides) {
          if (!high || s.score > high.score) high = Object.assign({ week: week.week }, s);
          if (!low || s.score < low.score) low = Object.assign({ week: week.week }, s);
        }
        const diff = Math.abs(hs - as);
        if (!margin || diff > margin.margin) {
          const winner = hs === as ? null : (hs > as ? sides[0] : sides[1]);
          const loser = hs === as ? null : (hs > as ? sides[1] : sides[0]);
          margin = { week: week.week, margin: diff, winner, loser };
        }
      }
    }
    return { cover, high, low, margin };
  }

  function nextMatchup(schedule, teamId, weeks) {
    if (!schedule || !schedule.weeks || !teamId) return null;
    const live = (weeks || []).find((w) => !weekIsFinal(w) && (w.matchups || []).length);
    if (live) return null;
    const finals = (weeks || []).filter(weekIsFinal).map((w) => Number(w.week));
    const next = (finals.length ? Math.max(...finals) : 0) + 1;
    const pairs = schedule.weeks[String(next)] || schedule.weeks[next];
    if (!Array.isArray(pairs)) return null;
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const a = resolveTeamId(pair[0]);
      const b = resolveTeamId(pair[1]);
      if (a === teamId) return { week: next, oppName: pair[1], oppId: b };
      if (b === teamId) return { week: next, oppName: pair[0], oppId: a };
    }
    return null;
  }

  function scoreChart(games, color) {
    const rows = games || [];
    if (!rows.length) {
      return `<p class="muted mb-0">Weekly scores show up here after a final week is posted.</p>`;
    }
    const nums = rows.map((g) => Number(g.score)).filter((n) => Number.isFinite(n));
    const max = Math.max(...nums, 1);
    const bars = rows.map((g) => {
      const px = Math.max(8, Math.round((Number(g.score) / max) * 112));
      const cls = g.result === "W" ? "win" : g.result === "L" ? "loss" : "tie";
      const label = g.result ? `${g.result} ${formatPts(g.score)}` : formatPts(g.score);
      const tint = !g.result && /^#[0-9a-fA-F]{3,8}$/.test(String(color || "")) ? `background:${color};` : "";
      return `<div class="vbar">
        <span class="vbar-pts">${WUC.escapeHtml(label)}</span>
        <div class="vbar-fill ${cls}" style="height:${px}px;${tint}"></div>
        <span class="vbar-wk">W${WUC.escapeHtml(g.week)}</span>
      </div>`;
    }).join("");
    return `<div class="vbars" role="img" aria-label="Weekly scores">${bars}</div>`;
  }

  function pfChart(teams) {
    const rows = sortStandings(teams, "pf").filter((t) => pointsFor(t) != null);
    if (!rows.length) return `<p class="muted mb-0">Points for aren’t in the team file yet.</p>`;
    const max = Math.max(...rows.map((t) => pointsFor(t) || 0), 1);
    return `<div class="bar-chart" role="img" aria-label="Points for by team">${rows.map((t) => {
      const pf = pointsFor(t) || 0;
      const width = Math.max(4, Math.round((pf / max) * 100));
      const color = t.color || "#69BE28";
      return `<div class="bar-row">
        <span class="bar-label">${teamLinkHtml(t.id, { size: "sm", text: t.abbrev || t.name })}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${WUC.escapeHtml(color)}"></div></div>
        <span class="bar-val">${formatPts(pf)}</span>
      </div>`;
    }).join("")}</div>`;
  }

  function renderMatchups(matchups, weekFinal) {
    const list = matchups || [];
    if (!list.length) return `<p class="muted mb-0">No matchups posted for this week.</p>`;
    return `<ul class="h2h-list">${list.map((m) => {
      const hs = Number(m.homeScore);
      const as = Number(m.awayScore);
      const st = String(m.status || "").toLowerCase();
      const final = Boolean(weekFinal) || st === "final";
      const homeWin = final && Number.isFinite(hs) && Number.isFinite(as) && hs > as;
      const awayWin = final && Number.isFinite(hs) && Number.isFinite(as) && as > hs;
      const tag = final ? "FINAL" : (st === "live" ? "LIVE" : (st ? st.toUpperCase() : ""));
      return `<li class="h2h-card">
        <div class="h2h-main">
          <div class="h2h-side${awayWin ? " is-win" : ""}">${teamLinkHtml(m.away, { size: "sm" })}<span class="h2h-score">${formatPts(as)}</span></div>
          <div class="h2h-side${homeWin ? " is-win" : ""}">${teamLinkHtml(m.home, { size: "sm" })}<span class="h2h-score">${formatPts(hs)}</span></div>
        </div>
        ${tag ? `<span class="mu-tag">${WUC.escapeHtml(tag)}</span>` : ""}
      </li>`;
    }).join("")}</ul>`;
  }

  function renderRoster(roster) {
    if (!roster || typeof roster !== "object") return "";
    const known = POS_ORDER.filter((p) => Array.isArray(roster[p]) && roster[p].length);
    const extra = Object.keys(roster).filter((k) => !POS_ORDER.includes(k) && Array.isArray(roster[k]) && roster[k].length && !/pending/i.test(k));
    const keys = [...known, ...extra];
    if (!keys.length) return `<p class="muted mb-0">No players listed in this depth chart.</p>`;
    return keys.map((pos) => `
      <div class="pos-block">
        <div class="pos-label">${WUC.escapeHtml(pos)}</div>
        <div class="player-chips">
          ${roster[pos].map((n) => `<span class="chip${String(pos).toUpperCase() === "IR" ? " ir" : ""}">${WUC.escapeHtml(n)}</span>`).join("")}
        </div>
      </div>`).join("");
  }

  function renderStandingsRows(teams, mode, opts) {
    const options = opts || {};
    const weeks = options.weeks || [];
    const ranked = sortStandings(teams, mode);
    const sliced = options.limit ? ranked.slice(0, options.limit) : ranked;
    if (!sliced.length) return `<p class="muted mb-0">No clubs in the team file yet.</p>`;
    const compact = Boolean(options.compact);
    const body = sliced.map((t, i) => {
      const pf = pointsFor(t);
      const pa = pointsAgainst(t);
      const diff = pf != null && pa != null ? pf - pa : null;
      const games = weeks.length ? gamesForTeam(t.id, weeks) : [];
      const streak = weeks.length ? streakFromLog(games, t) : null;
      const faab = t.faab != null ? `$${t.faab}` : "—";
      const diffCls = diff == null ? "" : diff > 0 ? " diff-pos" : diff < 0 ? " diff-neg" : "";
      return `<tr style="--team-color:${WUC.escapeHtml(t.color || "#69BE28")}">
        <td class="col-rank">${i + 1}</td>
        <td class="col-team">${teamLinkHtml(t.id, { size: "sm" })}</td>
        <td class="col-record">${WUC.escapeHtml(recordLabel(t))}</td>
        ${compact ? "" : `<td class="col-owner">${WUC.escapeHtml(t.owner || "—")}</td>`}
        <td class="col-num">${pf == null ? "—" : formatPts(pf)}</td>
        ${compact ? "" : `<td class="col-num">${pa == null ? "—" : formatPts(pa)}</td>`}
        ${compact ? "" : `<td class="col-num${diffCls}">${formatDiff(diff)}</td>`}
        ${compact ? "" : `<td class="col-optional">${faab}</td>`}
        ${compact ? "" : `<td class="col-optional">${streak ? WUC.escapeHtml(streak) : "—"}</td>`}
      </tr>`;
    }).join("");
    const head = compact
      ? `<tr><th class="col-rank">#</th><th class="col-team">Team</th><th class="col-record">W-L</th><th class="col-num">PF</th></tr>`
      : `<tr><th class="col-rank">#</th><th class="col-team">Team</th><th class="col-record">W-L</th><th class="col-owner">Owner</th><th class="col-num">PF</th><th class="col-num">PA</th><th class="col-num">+/−</th><th class="col-optional">FAAB</th><th class="col-optional">Streak</th></tr>`;
    return `<div class="table-scroll"><table class="trade-table standings-table" aria-label="League standings">
      <thead>${head}</thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  function skeleton(rows) {
    const n = rows || 3;
    const bars = Array.from({ length: n }, (_, i) => `<div class="skeleton-bar${i === 1 ? " med" : i === 2 ? " short" : ""}"></div>`).join("");
    return `<div class="skeleton-stack" aria-hidden="true">${bars}</div>`;
  }

  function softError(msg) {
    return `<div class="soft-error">${WUC.escapeHtml(msg)}<br/><button type="button" class="btn btn-ghost" data-retry="1">Refresh</button></div>`;
  }

  function emptyState(msg) {
    return `<p class="muted mb-0">${WUC.escapeHtml(msg)}</p>`;
  }

  document.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-retry]")) location.reload();
  });

  Object.assign(window.WUC, {
    indexTeams,
    allTeams,
    safeId,
    resolveTeamId,
    teamById,
    teamHref,
    teamLinkHtml,
    loadOptional,
    formatPts,
    formatDiff,
    pointsFor,
    pointsAgainst,
    recordLabel,
    sortStandings,
    isPublicClaim,
    publicClaims,
    completedTrades,
    publicTransactions,
    publicFaabTrades,
    weekIsFinal,
    loadSeasonWeeks,
    gamesForTeam,
    streakFromLog,
    weeksAreComplete,
    seasonHighlights,
    nextMatchup,
    scoreChart,
    pfChart,
    renderMatchups,
    renderRoster,
    renderStandingsRows,
    skeleton,
    softError,
    emptyState,
    POS_ORDER
  });
})();

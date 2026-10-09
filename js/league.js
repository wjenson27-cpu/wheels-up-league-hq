/* Shared league data helpers. Reads the existing data/*.json files.
   Pending FAAB bids and pending trade offers are never rendered. */
(function () {
  const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "LB", "DL", "DB", "FLEX", "IDP", "IR"];

  /* Playoff odds. Confirm with Bill if the league changes this.
     spots: 8 — data/history.json (2024 “8-team playoffs”; 2025 champ was a 5-seed
       and the 1-seed played round 1, so no bye).
     regularSeasonWeeks: 14 — 2024 best record was 11-3; 2025 records include 12-2 and 2-12.
     No divisions are described anywhere in the repo.
     The sim reads schedule.weeks. A week that is missing there is a random pairing.
     Tiebreak matches the site table: wins, then losses, then ties, then points for
     (history.json: regular-season order by record then PF).
     Those records come from posted final scores, not teams.json. */
  const PLAYOFF_ODDS = {
    spots: 8,
    regularSeasonWeeks: 14,
    simulations: 10000,
    shrinkGames: 4
  };
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
    const aliasKeys = Object.keys(ALIAS_TO_ID).sort((a, b) => b.length - a.length);
    for (const key of aliasKeys) {
      if (key.length < 4) continue;
      if (n.includes(key)) return ALIAS_TO_ID[key];
    }
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

  function officialName(labelOrId, fallback) {
    const id = resolveTeamId(labelOrId);
    const team = id ? teamById(id) : null;
    if (team && team.name) return team.name;
    if (fallback) return String(fallback);
    return labelOrId ? String(labelOrId) : "—";
  }

  function officialOwner(labelOrId) {
    const id = resolveTeamId(labelOrId);
    const team = id ? teamById(id) : null;
    return (team && team.owner) || "";
  }

  /* One display pass for free text that still uses an old club name. */
  function displayText(text) {
    let s = String(text || "");
    if (!s) return s;
    const hyper = officialName("hyper");
    const ttab = officialName("ttab");
    s = s.replace(/Greenacres Goblins\s*\/\s*Hypersecretors/gi, hyper);
    s = s.replace(/\bHypersecretors\b/g, (match, offset, str) => {
      return str.slice(Math.max(0, offset - 4), offset) === "The " ? match : hyper;
    });
    if (ttab && ttab !== "ttab") s = s.replace(/\bTTAB\b/g, ttab);
    return s;
  }

  function publicNote(text) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    if (s.includes("|")) return "";
    if (/FAAB\s*\$/i.test(s)) return "";
    if (/\bW\d+\s+FINAL\b/i.test(s)) return "";
    if (s.length > 180) return "";
    return s;
  }

  function teamLinkHtml(labelOrId, opts) {
    const optsSafe = opts || {};
    const id = resolveTeamId(labelOrId);
    const team = id ? teamById(id) : {};
    const text = optsSafe.text != null ? optsSafe.text : officialName(id || labelOrId);
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

  function compareRecord(a, b) {
    const bw = (Number(b.wins) || 0) - (Number(a.wins) || 0);
    if (bw) return bw;
    const losses = (Number(a.losses) || 0) - (Number(b.losses) || 0);
    if (losses) return losses;
    const ties = (Number(b.ties) || 0) - (Number(a.ties) || 0);
    if (ties) return ties;
    const pf = (pointsFor(b) || 0) - (pointsFor(a) || 0);
    if (pf) return pf;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }

  function sortStandings(teams, mode, extra) {
    const list = [...(teams || [])];
    if (mode === "playoff") {
      const byId = (extra && extra.byId) || {};
      list.sort((a, b) => {
        const ar = byId[a.id] ? byId[a.id].rate : -1;
        const br = byId[b.id] ? byId[b.id].rate : -1;
        if (br !== ar) return br - ar;
        return String(a.name).localeCompare(String(b.name));
      });
      return list;
    }
    if (mode === "pf") {
      list.sort((a, b) => (pointsFor(b) || 0) - (pointsFor(a) || 0) || String(a.name).localeCompare(String(b.name)));
      return list;
    }
    if (mode === "pa") {
      list.sort((a, b) => (pointsAgainst(a) || 0) - (pointsAgainst(b) || 0) || String(a.name).localeCompare(String(b.name)));
      return list;
    }
    list.sort(compareRecord);
    return list;
  }

  /* Wins, losses, ties, and points from posted final score files only.
     teams.json standingsRank / record / pointsFor are not used. */
  function recordFromGames(teamId, weeks) {
    const games = gamesForTeam(teamId, weeks).filter((g) => g.final && Number.isFinite(g.score) && Number.isFinite(g.oppScore));
    let wins = 0;
    let losses = 0;
    let ties = 0;
    let pf = 0;
    let pa = 0;
    games.forEach((g) => {
      pf += Number(g.score);
      pa += Number(g.oppScore);
      if (g.result === "W") wins += 1;
      else if (g.result === "L") losses += 1;
      else ties += 1;
    });
    const round = (n) => Math.round(n * 10) / 10;
    return {
      wins,
      losses,
      ties,
      pointsFor: games.length ? round(pf) : null,
      pointsAgainst: games.length ? round(pa) : null,
      played: games.length
    };
  }

  function liveStandings(teams, weeks) {
    const anyFinal = (weeks || []).some(weekIsFinal);
    const list = (teams || []).filter((t) => t && t.id).map((t) => {
      const rec = anyFinal
        ? recordFromGames(t.id, weeks)
        : { wins: 0, losses: 0, ties: 0, pointsFor: null, pointsAgainst: null, played: 0 };
      const record = rec.played
        ? (rec.ties ? `${rec.wins}-${rec.losses}-${rec.ties}` : `${rec.wins}-${rec.losses}`)
        : null;
      return Object.assign({}, t, {
        wins: rec.played ? rec.wins : null,
        losses: rec.played ? rec.losses : null,
        ties: rec.played ? rec.ties : null,
        pointsFor: rec.pointsFor,
        pointsAgainst: rec.pointsAgainst,
        pf: rec.pointsFor,
        pa: rec.pointsAgainst,
        record,
        played: rec.played,
        standingsRank: null
      });
    });
    sortStandings(list, "official").forEach((t, i) => {
      if (t.played) t.standingsRank = i + 1;
    });
    return list;
  }

  /* Latest published power board. pendingPublish hides the whole file, or one row. */
  function publishedPowerRanks(data) {
    const byId = {};
    if (!data || data.pendingPublish === true) return { week: null, byId, published: false };
    const week = Number(data.week) || null;
    (data.rankings || []).forEach((row) => {
      if (!row || row.pendingPublish === true || !row.teamId) return;
      const rank = Number(row.rank);
      if (!Number.isFinite(rank)) return;
      byId[row.teamId] = { rank, week };
    });
    return { week, byId, published: true };
  }

  /* FAAB left comes from faab.json balances. teams.json faab is ignored. */
  function applyFaab(teams, faabFile) {
    const byId = {};
    const balances = faabFile && Array.isArray(faabFile.teamBalances) ? faabFile.teamBalances : null;
    (balances || []).forEach((b) => {
      if (b && b.id) byId[b.id] = b.remaining;
    });
    return (teams || []).map((t) => {
      const known = balances && Object.prototype.hasOwnProperty.call(byId, t.id) && byId[t.id] != null && byId[t.id] !== "";
      return Object.assign({}, t, { faab: known ? byId[t.id] : null });
    });
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

  function playerKey(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function renderRoster(roster) {
    if (!roster || typeof roster !== "object") return "";
    const ir = new Set((Array.isArray(roster.IR) ? roster.IR : []).map(playerKey).filter(Boolean));
    const known = POS_ORDER.filter((p) => Array.isArray(roster[p]) && roster[p].length);
    const extra = Object.keys(roster).filter((k) => !POS_ORDER.includes(k) && Array.isArray(roster[k]) && roster[k].length && !/pending/i.test(k));
    const keys = [...known, ...extra];
    const blocks = keys.map((pos) => {
      const onIr = String(pos).toUpperCase() === "IR";
      const names = roster[pos].filter((n) => onIr || !ir.has(playerKey(n)));
      if (!names.length) return "";
      return `
      <div class="pos-block">
        <div class="pos-label">${WUC.escapeHtml(pos)}</div>
        <div class="player-chips">
          ${names.map((n) => `<span class="chip${onIr ? " ir" : ""}">${WUC.escapeHtml(n)}</span>`).join("")}
        </div>
      </div>`;
    }).filter(Boolean);
    if (!blocks.length) return `<p class="muted mb-0">No players listed in this depth chart.</p>`;
    return blocks.join("");
  }

  function meanSd(values) {
    if (!values.length) return { mean: null, sd: null, n: 0 };
    const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
    if (values.length < 2) return { mean, sd: null, n: values.length };
    const variance = values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (values.length - 1);
    return { mean, sd: Math.sqrt(variance), n: values.length };
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRandn(rng) {
    return function randn() {
      let u = 0;
      let v = 0;
      while (u === 0) u = rng();
      while (v === 0) v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
  }

  function sampleScore(mean, sd, randn) {
    const x = mean + sd * randn();
    return Math.max(0, Math.round(x * 10) / 10);
  }

  /* schedule.weeks is the matchup list the sim reads.
     A week key that is present and not yet final is played as written.
     Any regular-season week that is not in that object is paired at random. */
  function scheduleRemaining(schedule, weeks, teams) {
    const finalWeeks = new Set((weeks || []).filter(weekIsFinal).map((w) => Number(w.week)));
    const idSet = new Set(teams.map((t) => t.id));
    const fixed = [];
    const weekMap = (schedule && schedule.weeks) || {};
    const scheduledWeeks = new Set();
    Object.keys(weekMap).forEach((key) => {
      const week = Number(key);
      if (!week || week > PLAYOFF_ODDS.regularSeasonWeeks) return;
      const pairs = weekMap[key];
      if (!Array.isArray(pairs) || !pairs.length) return;
      scheduledWeeks.add(week);
      if (finalWeeks.has(week)) return;
      pairs.forEach((pair) => {
        if (!Array.isArray(pair) || pair.length < 2) return;
        const a = resolveTeamId(pair[0]);
        const b = resolveTeamId(pair[1]);
        if (a && b && a !== b && idSet.has(a) && idSet.has(b)) fixed.push({ week, a, b });
      });
    });
    const openWeeks = [];
    const start = (finalWeeks.size ? Math.max(...finalWeeks) : 0) + 1;
    for (let week = start; week <= PLAYOFF_ODDS.regularSeasonWeeks; week += 1) {
      if (!finalWeeks.has(week) && !scheduledWeeks.has(week)) openWeeks.push(week);
    }
    const publishedFuture = [...scheduledWeeks].filter((week) => !finalWeeks.has(week) && week >= start).sort((a, b) => a - b);
    return { fixed, openWeeks, publishedFuture };
  }

  function copyStandings(teams, weeks) {
    const state = {};
    (teams || []).forEach((t) => {
      const rec = recordFromGames(t.id, weeks);
      state[t.id] = {
        wins: rec.wins,
        losses: rec.losses,
        ties: rec.ties,
        pf: rec.pointsFor || 0
      };
    });
    return state;
  }

  function playGame(state, model, a, b, randn) {
    const sa = sampleScore(model[a].mu, model[a].sd, randn);
    const sb = sampleScore(model[b].mu, model[b].sd, randn);
    state[a].pf += sa;
    state[b].pf += sb;
    if (sa > sb) {
      state[a].wins += 1;
      state[b].losses += 1;
    } else if (sb > sa) {
      state[b].wins += 1;
      state[a].losses += 1;
    } else {
      state[a].ties += 1;
      state[b].ties += 1;
    }
  }

  function rankIds(state, ids) {
    return [...ids].sort((a, b) => {
      const A = state[a];
      const B = state[b];
      if (B.wins !== A.wins) return B.wins - A.wins;
      if (A.losses !== B.losses) return A.losses - B.losses;
      if (B.ties !== A.ties) return B.ties - A.ties;
      if (B.pf !== A.pf) return B.pf - A.pf;
      return String(a).localeCompare(String(b));
    });
  }

  function shuffleIds(ids, rng) {
    const list = [...ids];
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const swap = list[i];
      list[i] = list[j];
      list[j] = swap;
    }
    return list;
  }

  function formatWeekSpan(weeks) {
    const nums = [...weeks].sort((a, b) => a - b);
    if (!nums.length) return "";
    const parts = [];
    let start = nums[0];
    let prev = nums[0];
    for (let i = 1; i <= nums.length; i += 1) {
      const n = nums[i];
      if (n === prev + 1) {
        prev = n;
        continue;
      }
      parts.push(start === prev ? String(start) : `${start}–${prev}`);
      start = n;
      prev = n;
    }
    return parts.join(", ");
  }

  function formatPlayoffLabel(row) {
    if (!row || row.rate == null) return "—";
    if (row.clinched) return "100%";
    if (row.eliminated) return "0%";
    const pct = row.rate * 100;
    if (pct >= 99.5) return ">99%";
    if (pct <= 0.5) return "<1%";
    return `${Math.round(pct)}%`;
  }

  function playoffOdds(teams, weeks, schedule) {
    const list = (teams || []).filter((t) => t && t.id);
    const spots = PLAYOFF_ODDS.spots;
    const sims = PLAYOFF_ODDS.simulations;
    if (list.length < spots) return null;
    const ids = list.map((t) => t.id);
    const byTeamScores = {};
    const allScores = [];
    list.forEach((t) => {
      const scores = gamesForTeam(t.id, weeks)
        .filter((g) => g.final && Number.isFinite(g.score))
        .map((g) => g.score);
      byTeamScores[t.id] = scores;
      allScores.push(...scores);
    });
    const league = meanSd(allScores);
    const leagueMean = league.mean != null ? league.mean : 120;
    const leagueSd = league.sd != null ? league.sd : 30;
    const shrink = PLAYOFF_ODDS.shrinkGames;
    const model = {};
    list.forEach((t) => {
      const stats = meanSd(byTeamScores[t.id] || []);
      const n = stats.n;
      const weight = n / (n + shrink);
      const mu = n ? weight * stats.mean + (1 - weight) * leagueMean : leagueMean;
      const teamSd = stats.sd != null ? stats.sd : leagueSd;
      const sd = Math.max(8, n ? weight * teamSd + (1 - weight) * leagueSd : leagueSd);
      model[t.id] = { mu, sd };
    });
    const { fixed, openWeeks, publishedFuture } = scheduleRemaining(schedule, weeks, list);
    const remainingFor = {};
    ids.forEach((id) => {
      remainingFor[id] = fixed.filter((g) => g.a === id || g.b === id).length + openWeeks.length;
    });
    const base = copyStandings(list, weeks);
    const standKey = [...ids]
      .sort()
      .map((id) => {
        const row = base[id];
        return [id, row.wins, row.losses, row.ties, row.pf].join(":");
      })
      .join("|");
    const scoreKey = [...ids].sort().map((id) => `${id}:${(byTeamScores[id] || []).join(",")}`).join("|");
    const schedKey = fixed.map((g) => `${g.week}:${g.a}<${g.b}`).sort().join("|");
    const finals = (weeks || []).filter(weekIsFinal).map((w) => Number(w.week));
    const through = finals.length ? Math.max(...finals) : 0;
    const seed = hashString([through, standKey, scoreKey, schedKey, openWeeks.join(",")].join("#"));
    const rng = mulberry32(seed);
    const randn = makeRandn(rng);
    const made = Object.fromEntries(ids.map((id) => [id, 0]));
    for (let sim = 0; sim < sims; sim += 1) {
      const state = copyStandings(list);
      fixed.forEach((g) => playGame(state, model, g.a, g.b, randn));
      openWeeks.forEach(() => {
        const order = shuffleIds(ids, rng);
        for (let i = 0; i + 1 < order.length; i += 2) {
          playGame(state, model, order[i], order[i + 1], randn);
        }
      });
      rankIds(state, ids).slice(0, spots).forEach((id) => { made[id] += 1; });
    }
    const byId = {};
    ids.forEach((id) => {
      const mine = base[id];
      const maxWins = mine.wins + remainingFor[id];
      let canPass = 0;
      let alreadyAhead = 0;
      ids.forEach((other) => {
        if (other === id) return;
        const theirMax = base[other].wins + remainingFor[other];
        if (theirMax >= mine.wins) canPass += 1;
        if (base[other].wins > maxWins) alreadyAhead += 1;
      });
      const noGamesLeft = ids.every((teamId) => remainingFor[teamId] === 0);
      const clinched = noGamesLeft
        ? rankIds(base, ids).indexOf(id) < spots
        : canPass < spots;
      const eliminated = noGamesLeft
        ? rankIds(base, ids).indexOf(id) >= spots
        : alreadyAhead >= spots;
      byId[id] = { rate: made[id] / sims, clinched, eliminated };
    });
    let schedNote = "Every remaining week uses a published matchup from the schedule file.";
    const openLabel = openWeeks.length === 1
      ? `Week ${openWeeks[0]} is not in the schedule file yet, so that week is a random matchup.`
      : `Weeks ${formatWeekSpan(openWeeks)} are not in the schedule file yet, so those weeks are random matchups.`;
    if (openWeeks.length && publishedFuture.length) {
      const pubLabel = publishedFuture.length === 1
        ? `week ${publishedFuture[0]}`
        : `weeks ${formatWeekSpan(publishedFuture)}`;
      schedNote = `Published matchups cover ${pubLabel}. ${openLabel}`;
    } else if (openWeeks.length) {
      schedNote = `No remaining weeks are in the schedule file yet. ${openLabel}`;
    }
    const footnote = `Playoff % is the share of ${sims.toLocaleString("en-US")} simulated seasons where that club finishes in the top ${spots}. Each club’s weekly score is based on what it has posted so far, pulled toward the league average while the sample is small. Tiebreak is wins, then losses, then points for. This uses an ${spots}-team playoff and a ${PLAYOFF_ODDS.regularSeasonWeeks}-week regular season, with no divisions and no byes — from the 2024–2025 results in the league history, not from a 2026 rules line. ${schedNote} The same posted scores and schedule always give the same percentages. Computed in your browser${through ? ` from scores through week ${through}` : ""}.`;
    return { byId, footnote, spots, simulations: sims };
  }

  function renderStandingsRows(teams, mode, opts) {
    const options = opts || {};
    const weeks = options.weeks || [];
    const playoff = options.playoff || null;
    const ranked = sortStandings(teams, mode, playoff);
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
      const odds = playoff && playoff.byId ? playoff.byId[t.id] : null;
      const oddsLabel = formatPlayoffLabel(odds);
      const oddsTitle = odds && odds.rate != null
        ? `${(odds.rate * 100).toFixed(1)}% of ${PLAYOFF_ODDS.simulations.toLocaleString("en-US")} seasons`
        : "";
      return `<tr style="--team-color:${WUC.escapeHtml(t.color || "#69BE28")}">
        <td class="col-rank">${i + 1}</td>
        <td class="col-team">${teamLinkHtml(t.id, { size: "sm" })}</td>
        <td class="col-record">${WUC.escapeHtml(recordLabel(t))}</td>
        ${compact ? "" : `<td class="col-owner">${WUC.escapeHtml(t.owner || "—")}</td>`}
        <td class="col-num">${pf == null ? "—" : formatPts(pf)}</td>
        ${compact ? "" : `<td class="col-num col-phone-hide">${pa == null ? "—" : formatPts(pa)}</td>`}
        ${compact ? "" : `<td class="col-num col-phone-hide${diffCls}">${formatDiff(diff)}</td>`}
        ${compact ? "" : `<td class="col-optional">${faab}</td>`}
        ${compact ? "" : `<td class="col-optional">${streak ? WUC.escapeHtml(streak) : "—"}</td>`}
        ${compact ? "" : `<td class="col-playoff" title="${WUC.escapeHtml(oddsTitle)}">${WUC.escapeHtml(oddsLabel)}</td>`}
      </tr>`;
    }).join("");
    const head = compact
      ? `<tr><th class="col-rank">#</th><th class="col-team">Team</th><th class="col-record">W-L</th><th class="col-num">PF</th></tr>`
      : `<tr><th class="col-rank">#</th><th class="col-team">Team</th><th class="col-record">W-L</th><th class="col-owner">Owner</th><th class="col-num">PF</th><th class="col-num col-phone-hide">PA</th><th class="col-num col-phone-hide">+/−</th><th class="col-optional">FAAB</th><th class="col-optional">Streak</th><th class="col-playoff">Playoff %</th></tr>`;
    return `<div class="table-scroll"><table class="trade-table standings-table" aria-label="League standings">
      <thead>${head}</thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  /* All-time head-to-head, Fantrax era. 2024–25 from data/h2h-history.json
     (consolation games are not in that file). 2026 is read live from the posted
     final score files, regular season (weeks 1–14) only, plus any later game that is
     explicitly tagged as a winners-bracket playoff. */
  const H2H_PROSE_NAME = { newman: "SPD’s" };

  function h2hGames(history, weeks) {
    const out = [];
    ((history && history.games) || []).forEach((g) => {
      if (!g || g.round === "consolation") return;
      const sa = Number(g.scoreA);
      const sb = Number(g.scoreB);
      if (!g.teamA || !g.teamB || !Number.isFinite(sa) || !Number.isFinite(sb)) return;
      out.push({ season: Number(g.season), week: Number(g.week), round: g.round === "playoff" ? "playoff" : "regular", bracket: g.bracket || "", a: g.teamA, b: g.teamB, sa, sb });
    });
    const histSeasons = new Set(out.map((g) => g.season));
    const season = Number((window.WUC_CONFIG && WUC_CONFIG.season) || 2026);
    if (!histSeasons.has(season)) {
      (weeks || []).filter(weekIsFinal).forEach((week) => {
        const wk = Number(week.week);
        (week.matchups || []).forEach((m) => {
          const tag = String(m.round || m.bracket || "").toLowerCase();
          let round = "regular";
          if (wk > PLAYOFF_ODDS.regularSeasonWeeks) {
            if (!/playoff|championship|semi|quarter|3rd/.test(tag) || /consol|loser|chump|toilet|placement|5th|7th|9th|11th|13th/.test(tag)) return;
            round = "playoff";
          }
          const a = resolveTeamId(m.home);
          const b = resolveTeamId(m.away);
          const sa = Number(m.homeScore);
          const sb = Number(m.awayScore);
          if (!a || !b || a === b || !Number.isFinite(sa) || !Number.isFinite(sb)) return;
          out.push({ season, week: wk, round, bracket: m.bracket || "", a, b, sa, sb, live: true });
        });
      });
    }
    out.sort((x, y) => x.season - y.season || x.week - y.week);
    return out;
  }

  function emptyLine() {
    return { w: 0, l: 0, t: 0, pf: 0, pa: 0, gp: 0 };
  }

  function addResult(line, mine, theirs) {
    line.gp += 1;
    line.pf += mine;
    line.pa += theirs;
    if (mine > theirs) line.w += 1;
    else if (mine < theirs) line.l += 1;
    else line.t += 1;
  }

  function h2hRecords(teamId, history, weeks) {
    const games = h2hGames(history, weeks);
    const seasons = [...new Set([...((history && history.seasons) || []), ...games.map((g) => g.season), Number((window.WUC_CONFIG && WUC_CONFIG.season) || 2026)])].map(Number).sort((a, b) => a - b);
    const mk = () => ({ all: emptyLine(), playoff: emptyLine(), bySeason: Object.fromEntries(seasons.map((s) => [s, emptyLine()])), last: null });
    const byOpp = {};
    const total = mk();
    games.forEach((g) => {
      let mine;
      let theirs;
      let opp;
      if (g.a === teamId) { mine = g.sa; theirs = g.sb; opp = g.b; }
      else if (g.b === teamId) { mine = g.sb; theirs = g.sa; opp = g.a; }
      else return;
      const row = byOpp[opp] || (byOpp[opp] = mk());
      [row, total].forEach((r) => {
        addResult(r.all, mine, theirs);
        addResult(r.bySeason[g.season] || (r.bySeason[g.season] = emptyLine()), mine, theirs);
        if (g.round === "playoff") addResult(r.playoff, mine, theirs);
      });
      row.last = { season: g.season, week: g.week, round: g.round, mine, theirs, result: mine > theirs ? "W" : mine < theirs ? "L" : "T" };
    });
    return { seasons, byOpp, total, games };
  }

  function lineLabel(line) {
    if (!line || !line.gp) return "—";
    return line.t ? `${line.w}-${line.l}-${line.t}` : `${line.w}-${line.l}`;
  }

  function lineMargin(line) {
    if (!line || !line.gp) return null;
    return Math.round(((line.pf - line.pa) / line.gp) * 10) / 10;
  }

  function linePct(line) {
    if (!line || !line.gp) return null;
    return (line.w + line.t / 2) / line.gp;
  }

  function renderH2H(teamId, history, weeks) {
    const rec = h2hRecords(teamId, history, weeks);
    const pastOwners = ((history && history.pastOwners) || []).filter((p) => p && p.id && p.id !== teamId)
      .map((p) => Object.assign({ past: true }, p));
    const opps = allTeams().filter((t) => t && t.id && t.id !== teamId).concat(pastOwners);
    const rows = opps.map((t) => ({ team: t, r: rec.byOpp[t.id] || null }));
    rows.sort((x, y) => ((y.r ? y.r.all.gp : 0) - (x.r ? x.r.all.gp : 0)) || String(x.team.name).localeCompare(String(y.team.name)));
    const seasons = rec.seasons;
    const yy = (s) => `’${String(s).slice(-2)}`;
    const diffCls = (n) => n == null ? "" : n > 0 ? "diff-pos" : n < 0 ? "diff-neg" : "";
    const marginCell = (line) => {
      const m = lineMargin(line);
      return `<span class="${diffCls(m)}">${m == null ? "—" : formatDiff(m)}</span>`;
    };
    const lastCell = (last) => {
      if (!last) return `<span class="muted">—</span>`;
      const tag = `${yy(last.season)} Wk ${last.week}${last.round === "playoff" ? " · PO" : ""}`;
      return `<span class="h2h-last"><span class="h2h-last-res"><span class="wl-badge is-${last.result.toLowerCase()}">${last.result}</span> <span class="h2h-last-score">${formatPts(last.mine)}–${formatPts(last.theirs)}</span></span> <span class="h2h-last-when">${WUC.escapeHtml(tag)}</span></span>`;
    };
    const detail = (r) => {
      if (!r) return `<span class="muted">No meetings yet</span>`;
      const parts = seasons.map((s) => `${yy(s)} ${lineLabel(r.bySeason[s])}`);
      if (r.playoff.gp) parts.push(`PO ${lineLabel(r.playoff)}`);
      const m = lineMargin(r.all);
      parts.push(`<span class="${diffCls(m)}">${m == null ? "—" : formatDiff(m)}/g</span>`);
      return parts.join(" · ");
    };
    const recCell = (r) => {
      const label = r ? lineLabel(r.all) : "—";
      const pct = r ? linePct(r.all) : null;
      const cls = pct == null ? "" : pct > 0.5 ? " is-up" : pct < 0.5 ? " is-down" : "";
      return `<span class="h2h-rec${cls}">${label}</span>`;
    };
    const body = rows.map(({ team, r }) => {
      let who;
      if (team.past) {
        /* An owner who has left the league: no team page and no logo file. */
        const full = team.label || team.name || team.id;
        const short = `${team.abbrev || team.name} ${team.seasons && team.seasons.length ? `’${String(team.seasons[0]).slice(-2)}–${String(team.seasons[team.seasons.length - 1]).slice(-2)}` : ""}`.trim();
        const chip = `<span class="team-mark team-mark-sm h2h-past-chip" aria-hidden="true">${WUC.escapeHtml(String(team.abbrev || team.name || "?").slice(0, 3))}</span>`;
        who = `<span class="team-inline h2h-past" title="${WUC.escapeHtml(full)}">${chip}<span class="opp-full">${WUC.escapeHtml(full)}</span><span class="opp-short">${WUC.escapeHtml(short)}</span></span>`;
      } else {
        const full = team.name || team.id;
        const short = team.abbrev || full;
        const inner = `<span class="team-inline">${WUC.teamMark(team.id, { size: "sm" })}<span class="opp-full">${WUC.escapeHtml(full)}</span><span class="opp-short">${WUC.escapeHtml(short)}</span></span>`;
        who = `<a class="team-link" href="${teamHref(team.id)}" title="${WUC.escapeHtml(full)}">${inner}</a>`;
      }
      return `<tr class="${team.past ? "h2h-row-past" : ""}" style="--team-color:${WUC.escapeHtml(team.color || "transparent")}">
        <td class="col-team">${who}<div class="h2h-detail">${detail(r)}</div></td>
        <td class="col-record">${recCell(r)}</td>
        ${seasons.map((s) => `<td class="col-num col-season">${r ? lineLabel(r.bySeason[s]) : "—"}</td>`).join("")}
        <td class="col-num col-po">${r && r.playoff.gp ? lineLabel(r.playoff) : "—"}</td>
        <td class="col-num col-pts">${r ? formatPts(r.all.pf) : "—"}</td>
        <td class="col-num col-pts">${r ? formatPts(r.all.pa) : "—"}</td>
        <td class="col-num col-margin">${r ? marginCell(r.all) : "—"}</td>
        <td class="col-last">${lastCell(r && r.last)}</td>
      </tr>`;
    }).join("");
    const t = rec.total;
    const foot = `<tr class="h2h-total">
        <td class="col-team"><strong>All-time</strong><div class="h2h-detail">${detail(t.all.gp ? t : null)}</div></td>
        <td class="col-record">${recCell(t.all.gp ? t : null)}</td>
        ${seasons.map((s) => `<td class="col-num col-season">${lineLabel(t.bySeason[s])}</td>`).join("")}
        <td class="col-num col-po">${t.playoff.gp ? lineLabel(t.playoff) : "—"}</td>
        <td class="col-num col-pts">${t.all.gp ? formatPts(Math.round(t.all.pf * 10) / 10) : "—"}</td>
        <td class="col-num col-pts">${t.all.gp ? formatPts(Math.round(t.all.pa * 10) / 10) : "—"}</td>
        <td class="col-num col-margin">${t.all.gp ? marginCell(t.all) : "—"}</td>
        <td class="col-last"><span class="muted">${t.all.gp} games</span></td>
      </tr>`;
    const head = `<tr><th class="col-team">Opponent</th><th class="col-record">W-L</th>${seasons.map((s) => `<th class="col-num col-season">${s}</th>`).join("")}<th class="col-num col-po">Playoffs</th><th class="col-num col-pts">PF</th><th class="col-num col-pts">PA</th><th class="col-num col-margin">Avg ±</th><th class="col-last">Last meeting</th></tr>`;
    const span = (ss) => {
      const list = (ss || []).map(Number).filter(Number.isFinite);
      if (!list.length) return "";
      return list.length > 1 ? `${list[0]}–${String(list[list.length - 1]).slice(-2)}` : String(list[0]);
    };
    const prose = (id) => H2H_PROSE_NAME[id] || officialName(id);
    const renamed = ((history && history.formerNames) || []).map((c) => {
      const old = (c.formerNames || []).map((f) => `${WUC.escapeHtml(f.name)} (${span(f.seasons)})`).join(" and ");
      return old ? `${WUC.escapeHtml(prose(c.teamId))} includes ${old}` : "";
    }).filter(Boolean);
    const leftLeague = ((history && history.pastOwners) || []).map((p) => {
      const who = p.nickname || p.owner || "a past owner";
      const next = p.successor ? ` and does not roll into ${WUC.escapeHtml(prose(p.successor))}${p.successorFrom ? `, who start in ${WUC.escapeHtml(p.successorFrom)}` : ""}` : "";
      return `${WUC.escapeHtml(who)}’s ${WUC.escapeHtml(p.name)} (${span(p.seasons)}) is shown as its own row${next}`;
    });
    const curSeason = seasons[seasons.length - 1];
    const histSeasons = ((history && history.seasons) || []).map(Number);
    const self = teamById(teamId) || {};
    const histGames = histSeasons.reduce((n, s) => n + ((t.bySeason[s] && t.bySeason[s].gp) || 0), 0);
    const newOwner = histSeasons.length && !histGames;
    const ownerName = self.owner ? `${self.owner}’s` : "this owner’s";
    const startNote = newOwner
      ? `${WUC.escapeHtml(prose(teamId))} joined in ${curSeason}, so this table starts with ${WUC.escapeHtml(ownerName)} ${curSeason} games.`
      : "";
    const notes = [
      `History follows the owner, not the chair or the team name.${renamed.length ? ` ${renamed.join("; ")}.` : ""}${leftLeague.length ? ` ${leftLeague.join("; ")}.` : ""}`,
      `Counts regular-season and winners-bracket playoff games (PO). Consolation games are not counted. The 2024 Fantrax bracket has no 3rd-place or placement games. ${curSeason} updates from posted final scores each week.`
    ];
    if (!t.all.gp) {
      const msg = newOwner
        ? `No results yet. ${WUC.escapeHtml(prose(teamId))} joined in ${curSeason}, and the head-to-head table fills in as ${WUC.escapeHtml(ownerName)} ${curSeason} games go final.`
        : "No head-to-head results posted yet.";
      return `<p class="h2h-empty">${msg}</p>
        <div class="h2h-notes">${notes.map((n) => `<p class="playoff-note muted">${n}</p>`).join("")}</div>`;
    }
    if (startNote) notes.unshift(startNote);
    return `<div class="table-scroll h2h-scroll"><table class="trade-table h2h-table" aria-label="All-time record against each team">
        <thead>${head}</thead>
        <tbody>${body}</tbody>
        <tfoot>${foot}</tfoot>
      </table></div>
      <div class="h2h-notes">${notes.map((n) => `<p class="playoff-note muted">${n}</p>`).join("")}</div>`;
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
    officialName,
    officialOwner,
    displayText,
    publicNote,
    teamLinkHtml,
    loadOptional,
    formatPts,
    formatDiff,
    pointsFor,
    pointsAgainst,
    recordLabel,
    sortStandings,
    liveStandings,
    publishedPowerRanks,
    applyFaab,
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
    playoffOdds,
    h2hGames,
    h2hRecords,
    renderH2H,
    scheduleRemaining,
    formatPlayoffLabel,
    PLAYOFF_ODDS,
    skeleton,
    softError,
    emptyState,
    POS_ORDER
  });
})();

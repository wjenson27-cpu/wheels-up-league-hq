/* Departures-board markup. Presentation only.
   Every figure is formatted by the existing WUC helpers. */
(function () {
  function esc(value) {
    return window.WUC && WUC.escapeHtml ? WUC.escapeHtml(value) : String(value ?? "");
  }

  function flaps(value, extra) {
    const text = value == null || value === "" ? "—" : String(value);
    const tiles = Array.from(text).map((ch, i) => {
      const narrow = /[,.'’:+\-]/.test(ch) ? " is-narrow" : "";
      const gap = ch === " " ? " is-gap" : "";
      return `<span class="flap-char${narrow}${gap}" style="--i:${Math.min(i, 14)}">${esc(ch)}</span>`;
    }).join("");
    const extraCls = extra ? ` ${extra}` : "";
    return `<span class="flap-group${extraCls}" role="img" aria-label="${esc(text)}"><span class="flap-tiles" aria-hidden="true">${tiles}</span></span>`;
  }

  function plainNum(value, extra) {
    const text = value == null || value === "" ? "—" : String(value);
    const cls = extra ? ` dep-plain ${extra}` : " dep-plain";
    return `<span class="${cls.trim()}">${esc(text)}</span>`;
  }

  function isBlankScore(value) {
    const text = value == null || value === "" ? "—" : String(value);
    return text === "—" || text === "–" || text === "-";
  }

  /* A missing score is a plain dash. A flap tile around it reads as an empty box. */
  function scoreReadout(value, extra) {
    const text = value == null || value === "" ? "—" : String(value);
    if (isBlankScore(text)) return `<span class="dep-blank">—</span>`;
    return flaps(text, extra);
  }

  function chip(label, kind) {
    if (!label) return "";
    return `<span class="dep-chip is-${kind}">${esc(label)}</span>`;
  }

  function flightCode(week, index) {
    const n = Number(week);
    const wk = Number.isFinite(n) ? String(n).padStart(2, "0") : "00";
    const letter = index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
    return `WU${wk}${letter}`;
  }

  function gateCode(index) {
    const n = Number(index);
    return `G${Number.isFinite(n) ? n + 1 : 1}`;
  }

  function spots() {
    return (window.WUC && WUC.PLAYOFF_ODDS && WUC.PLAYOFF_ODDS.spots) || 8;
  }

  function seedOf(team, official) {
    const rank = Number(team && team.standingsRank);
    if (Number.isFinite(rank) && rank > 0) return rank;
    const idx = (official || []).findIndex((row) => row && team && row.id === team.id);
    return idx >= 0 ? idx + 1 : null;
  }

  function standingStatus(team, seed, playoff) {
    const odds = playoff && playoff.byId ? playoff.byId[team.id] : null;
    if (odds && odds.clinched) return { label: "CLINCHED", kind: "final" };
    if (odds && odds.eliminated) return { label: "CANCELED", kind: "canceled" };
    const cut = spots();
    if (seed != null && seed <= cut) return { label: "ON TIME", kind: "ontime" };
    if (seed != null && seed > cut) return { label: "DELAYED", kind: "delayed" };
    return null;
  }

  function diffClass(diff) {
    if (diff == null || !Number.isFinite(Number(diff))) return "";
    if (Number(diff) > 0) return "is-pos";
    if (Number(diff) < 0) return "is-neg";
    return "";
  }

  function stat(key, label, valueHtml) {
    return `<div class="dep-stat" data-k="${key}"><span class="dep-inline-k">${esc(label)}</span><span class="dep-val">${valueHtml}</span></div>`;
  }

  function standings(teams, mode, opts) {
    const options = opts || {};
    const weeks = options.weeks || [];
    const playoff = options.playoff || null;
    const ranked = WUC.sortStandings(teams, mode, playoff);
    if (!ranked.length) return `<p class="muted mb-0">No clubs in the team file yet.</p>`;
    const official = WUC.sortStandings(teams, "official");
    const cut = spots();
    const rows = [];
    ranked.forEach((team, index) => {
      const pf = WUC.pointsFor(team);
      const pa = WUC.pointsAgainst(team);
      const diff = pf != null && pa != null ? pf - pa : null;
      const games = weeks.length ? WUC.gamesForTeam(team.id, weeks) : [];
      const streak = weeks.length ? WUC.streakFromLog(games, team) : null;
      const faab = team.faab != null ? `$${team.faab}` : "—";
      const odds = playoff && playoff.byId ? playoff.byId[team.id] : null;
      const oddsLabel = WUC.formatPlayoffLabel(odds);
      const oddsTitle = odds && odds.rate != null ? `${(odds.rate * 100).toFixed(1)}%` : "";
      const owner = WUC.publicOwner(team.owner, team.id, "—");
      const record = WUC.recordLabel(team);
      const seed = seedOf(team, official);
      const status = standingStatus(team, seed, playoff);
      const next = ranked[index + 1];
      const nextSeed = next ? seedOf(next, official) : null;
      const canceled = status && status.kind === "canceled";
      const mark = WUC.teamMark ? WUC.teamMark(team.id, { size: "sm" }) : "";
      const name = WUC.officialName(team.id);
      const pfText = pf == null ? "—" : WUC.formatPts(pf);
      const paText = pa == null ? "—" : WUC.formatPts(pa);
      rows.push(`<tr class="dep-row dep-stand-row${canceled ? " is-canceled" : ""}" data-seed="${seed == null ? "" : seed}">
        <td class="dep-rank col-rank" data-k="rank"><span class="dep-val">${flaps(index + 1)}</span></td>
        <td class="dep-team col-team" data-k="team">
          <a class="dep-club team-link" href="${WUC.teamHref(team.id)}" title="${esc(name)}">
            ${mark}
            <span class="dep-club-text">
              <span class="team-inline"><span class="dep-val dep-name">${esc(name)}</span></span>
              <span class="dep-owner-line" data-k="owner"><span class="dep-val">${owner ? esc(owner) : ""}</span></span>
            </span>
          </a>
        </td>
        <td class="dep-stat col-record" data-k="record"><span class="dep-val">${flaps(record)}</span></td>
        <td class="dep-stat col-num dep-pf" data-k="pf"><span class="dep-val">${flaps(pfText)}</span></td>
        <td class="dep-stat dep-x col-pa" data-k="pa"><span class="dep-val">${plainNum(paText)}</span></td>
        <td class="dep-stat dep-x" data-k="diff"><span class="dep-val">${plainNum(WUC.formatDiff(diff), diffClass(diff))}</span></td>
        <td class="dep-stat dep-x" data-k="faab"><span class="dep-val">${plainNum(faab)}</span></td>
        <td class="dep-stat dep-x" data-k="streak"><span class="dep-val">${flaps(streak || "—")}</span></td>
        <td class="dep-stat col-playoff" data-k="playoff" title="${esc(oddsTitle)}"><span class="dep-val">${flaps(oddsLabel)}</span></td>
        <td class="dep-status">${status ? chip(status.label, status.kind) : ""}</td>
        <td class="dep-break" aria-hidden="true"></td>
        <td class="dep-more-cell"><button type="button" class="dep-more-btn" aria-expanded="false">More</button></td>
      </tr>`);
      if (mode === "official" && seed != null && nextSeed != null && seed <= cut && nextSeed > cut) {
        rows.push(`<tr class="dep-cut-row"><td colspan="10"><div class="dep-cut" role="separator"><span>Playoff line</span></div></td></tr>`);
      }
    });
    const lineNote = mode === "official"
      ? `The dashed line sits after seed ${cut} in this record order.`
      : "The playoff line is drawn in record order. Status still uses that seed.";
    return `<table class="trade-table standings-table dep-board dep-standings" aria-label="League standings">
      <colgroup>
        <col class="dep-c-rank"><col class="dep-c-team"><col class="dep-c-sm"><col class="dep-c-num">
        <col class="dep-c-num"><col class="dep-c-diff"><col class="dep-c-sm"><col class="dep-c-sm">
        <col class="dep-c-play"><col class="dep-c-status">
      </colgroup>
      <thead><tr class="dep-stand-head">
        <th class="h-rank col-rank">#</th>
        <th class="h-team col-team">Team</th>
        <th class="h-record col-record">W-L</th>
        <th class="h-pf col-num">PF</th>
        <th class="h-pa">PA</th>
        <th class="h-diff">+/−</th>
        <th class="h-faab">FAAB</th>
        <th class="h-streak">Streak</th>
        <th class="h-playoff col-playoff">Playoff %</th>
        <th class="h-status">Status</th>
      </tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
      <p class="dep-legend">CLINCHED and CANCELED come from the playoff odds. ON TIME is a seed in the top ${cut}. DELAYED is seed ${cut + 1} or lower. ${lineNote}</p>`;
  }

  function sideLine(nameHtml, scoreText, win, which) {
    return `<div class="dep-side dep-side-${which}${win ? " is-win" : ""}">
      <div class="dep-who">${nameHtml}</div>
      <div class="dep-score">${scoreReadout(scoreText, win ? "is-win" : "")}</div>
    </div>`;
  }

  function gameHead() {
    return `<div class="dep-head dep-game-head"><span>Flight</span><span>Gate</span><span class="dep-head-match">Matchup</span><span>Status</span></div>`;
  }

  function statusKind(tag) {
    if (tag === "FINAL") return "final";
    if (tag === "LIVE" || tag === "ON TIME" || tag === "SCHEDULED") return "ontime";
    if (tag === "CANCELED") return "canceled";
    return "delayed";
  }

  function gameTag(matchup, weekFinal) {
    const st = String((matchup && matchup.status) || "").toLowerCase();
    const final = Boolean(weekFinal) || st === "final";
    if (final) return "FINAL";
    if (st === "live") return "LIVE";
    if (st) return st.toUpperCase();
    return "";
  }

  function scoreboard(matchups, opts) {
    const options = opts || {};
    const list = matchups || [];
    if (!list.length) return `<p class="muted mb-0">No matchups posted for this week.</p>`;
    const week = options.week;
    const rows = list.map((matchup, index) => {
      const hs = Number(matchup.homeScore);
      const as = Number(matchup.awayScore);
      const tag = gameTag(matchup, options.weekFinal);
      const final = tag === "FINAL";
      const homeWin = final && Number.isFinite(hs) && Number.isFinite(as) && hs > as;
      const awayWin = final && Number.isFinite(hs) && Number.isFinite(as) && as > hs;
      const slot = Number.isFinite(Number(options.slot)) ? Number(options.slot) : index;
      const flight = options.flight || flightCode(week, slot);
      const gate = options.gate || gateCode(slot);
      return `<article class="dep-row dep-game-line${tag === "CANCELED" ? " is-canceled" : ""}">
        <div class="dep-codes">
          <div class="dep-flight">${flaps(flight)}</div>
          <div class="dep-gate">${flaps(gate)}</div>
        </div>
        <div class="dep-dest">
          <div class="dep-pair">
            ${sideLine(WUC.teamLinkHtml(matchup.away, { size: "sm" }), WUC.formatPts(as), awayWin, "a")}
            ${sideLine(WUC.teamLinkHtml(matchup.home, { size: "sm" }), WUC.formatPts(hs), homeWin, "b")}
          </div>
        </div>
        <div class="dep-status">${tag ? chip(tag, statusKind(tag)) : ""}</div>
      </article>`;
    }).join("");
    return `<div class="dep-board dep-schedule-games" role="list" aria-label="Week ${esc(week == null ? "" : week)} matchups">${gameHead()}${rows}</div>`;
  }

  function weekBoard(week) {
    if (!week) return WUC.emptyState("No score file for that week yet.");
    return scoreboard(week.matchups || [], {
      week: week.week,
      weekFinal: WUC.weekIsFinal(week)
    });
  }

  function pairScore(weekObj, teamId) {
    if (!weekObj || !teamId) return null;
    const games = weekObj.matchups || [];
    for (let i = 0; i < games.length; i += 1) {
      const game = games[i];
      const home = WUC.resolveTeamId(game.home);
      const away = WUC.resolveTeamId(game.away);
      if (home === teamId) return game.homeScore;
      if (away === teamId) return game.awayScore;
    }
    return null;
  }

  function schedulePage(schedule, weeks) {
    const weekMap = (schedule && schedule.weeks) || {};
    const posted = {};
    (weeks || []).forEach((week) => { posted[Number(week.week)] = week; });
    const keys = Object.keys(weekMap).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    if (!keys.length) return `<p class="muted mb-0">No weeks in the schedule file yet.</p>`;
    const finals = (weeks || []).filter(WUC.weekIsFinal).map((week) => Number(week.week));
    const latestFinal = finals.length ? Math.max.apply(null, finals) : 0;
    const blocks = keys.map((week) => {
      const pairs = weekMap[String(week)] || weekMap[week] || [];
      const postedWeek = posted[week] || null;
      const isFinal = postedWeek ? WUC.weekIsFinal(postedWeek) : false;
      const tag = isFinal ? "FINAL" : postedWeek ? "NOT POSTED" : "SCHEDULED";
      const kind = statusKind(tag === "NOT POSTED" ? "DELAYED" : tag);
      const open = week === 1 || week > latestFinal;
      const games = (Array.isArray(pairs) ? pairs : []).map((pair, index) => {
        const aName = pair && pair[0];
        const bName = pair && pair[1];
        const aId = WUC.resolveTeamId(aName);
        const bId = WUC.resolveTeamId(bName);
        const aScore = pairScore(postedWeek, aId);
        const bScore = pairScore(postedWeek, bId);
        const aPts = aScore == null ? "—" : WUC.formatPts(aScore);
        const bPts = bScore == null ? "—" : WUC.formatPts(bScore);
        let aWin = false;
        let bWin = false;
        if (isFinal && aScore != null && bScore != null) {
          const an = Number(aScore);
          const bn = Number(bScore);
          if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) {
            aWin = an > bn;
            bWin = bn > an;
          }
        }
        return `<article class="dep-row dep-game-line">
          <div class="dep-codes">
            <div class="dep-flight">${flaps(flightCode(week, index))}</div>
            <div class="dep-gate">${flaps(gateCode(index))}</div>
          </div>
          <div class="dep-dest">
            <div class="dep-pair">
              ${sideLine(WUC.teamLinkHtml(aId || aName, { size: "sm" }), aPts, aWin, "a")}
              ${sideLine(WUC.teamLinkHtml(bId || bName, { size: "sm" }), bPts, bWin, "b")}
            </div>
          </div>
          <div class="dep-status">${chip(tag, kind)}</div>
        </article>`;
      }).join("");
      return `<details class="dep-week"${open ? " open" : ""}>
        <summary class="dep-week-sum">
          ${flaps(String(week).padStart(2, "0"))}
          <span class="dep-week-label">Week ${esc(week)} · ${Array.isArray(pairs) ? pairs.length : 0} games</span>
          ${chip(tag, kind)}
        </summary>
        <div class="dep-board dep-schedule-games" role="list">${gameHead()}${games}</div>
      </details>`;
    }).join("");
    return blocks;
  }

  function txKind(type) {
    const label = String(type || "Move").toUpperCase();
    if (label === "CANCELED" || label === "CANCELLED") return { label, kind: "canceled" };
    if (label === "TRADE") return { label, kind: "final" };
    if (label === "ADD" || label === "ADD/DROP") return { label, kind: "ontime" };
    return { label, kind: "delayed" };
  }

  function transactions(items) {
    const list = items || [];
    if (!list.length) return `<p class="muted mb-0">No transactions loaded yet.</p>`;
    const rows = list.map((item) => {
      const status = txKind(item.type);
      const when = item.time ? String(item.time) : "—";
      const canceled = status.kind === "canceled";
      return `<article class="dep-row dep-tx-row${canceled ? " is-canceled" : ""}">
        <div class="dep-when">
          <div class="dep-tx-flight"><span class="dep-k">Flight</span>${flaps(WUC.formatDate(item.date))}</div>
          <div class="dep-tx-gate"><span class="dep-k">Gate</span>${flaps(when)}</div>
        </div>
        <div class="dep-tx-main">
          <span class="dep-k">Team</span>
          <div class="dep-val">${WUC.teamLinkHtml(item.teamId || item.team, { size: "sm" })}</div>
          <p class="dep-summary">${esc(WUC.displayText(item.summary || ""))}</p>
        </div>
        <div class="dep-status">${chip(status.label, status.kind)}</div>
      </article>`;
    }).join("");
    return `<div class="dep-board dep-tx" role="list" aria-label="League transaction feed">${rows}</div>`;
  }

  const api = {
    flaps,
    chip,
    flightCode,
    gateCode,
    standings,
    scoreboard,
    weekBoard,
    schedulePage,
    transactions,
    statusKind,
    scoreReadout,
    gameHead
  };

  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".dep-more-btn");
    if (!btn) return;
    const row = btn.closest(".dep-stand-row");
    if (!row) return;
    const open = row.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.textContent = open ? "Less" : "More";
  });

  window.WUC = window.WUC || {};
  window.WUC.board = api;
})();

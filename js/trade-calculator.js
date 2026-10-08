/* Wheels Up trade calculator. Hypothetical only. Reads local JSON. */
(function () {
  const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  const POS_ORDER = ["QB", "RB", "WR", "TE", "LB", "DL", "DB"];
  const SKILL = new Set(["RB", "WR", "TE"]);
  const IDP = new Set(["DL", "LB", "DB"]);

  const state = {
    teams: [],
    rosters: {},
    values: null,
    byKey: new Map(),
    a: "",
    b: "",
    aSend: [],
    bSend: [],
    aFaab: 0,
    bFaab: 0,
    openPicker: ""
  };

  function normName(name) {
    const text = String(name || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/'/g, "")
      .replace(/\./g, "")
      .replace(/-/g, " ")
      .replace(/[^a-z\s]/g, " ");
    return text
      .split(/\s+/)
      .filter((part) => part && !SUFFIXES.has(part))
      .join(" ");
  }

  function esc(value) {
    return window.WUC.escapeHtml(value == null ? "" : value);
  }

  function fmt(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "0.0";
    return num.toFixed(1);
  }

  function teamById(id) {
    return state.teams.find((team) => team.id === id) || null;
  }

  function lookup(name) {
    return state.byKey.get(normName(name)) || null;
  }

  function pointsPerDollar() {
    const faab = state.values && state.values.faab;
    return faab && Number(faab.pointsPerDollar) > 0 ? Number(faab.pointsPerDollar) : 0;
  }

  function lineupRules() {
    return (state.values && state.values.lineup) || null;
  }

  function rosterList(teamId) {
    const doc = state.rosters[teamId];
    const roster = (doc && doc.roster) || {};
    const ir = new Set(roster.IR || []);
    const rows = [];
    POS_ORDER.forEach((pos) => {
      (roster[pos] || []).forEach((name) => {
        const valued = lookup(name);
        rows.push({
          name,
          pos,
          ir: ir.has(name),
          value: valued ? Number(valued.value) || 0 : 0,
          ppg: valued ? valued.ppg : null,
          games: valued ? valued.games : null,
          nflTeam: valued ? valued.nflTeam : "",
          injury: valued ? valued.injury || "" : "",
          unvalued: !valued
        });
      });
    });
    return rows;
  }

  function faabLeft(teamId) {
    const team = teamById(teamId);
    if (team && team.faab != null && team.faab !== "") return Number(team.faab) || 0;
    const doc = state.rosters[teamId];
    return doc && doc.faabLeft != null ? Number(doc.faabLeft) || 0 : 0;
  }

  function optimize(players) {
    const rules = lineupRules();
    const empty = { starters: [], starterNames: new Set(), total: 0, slotOf: {} };
    if (!rules) return empty;
    const active = players.filter((player) => !player.ir);
    const byPos = {};
    active.forEach((player) => {
      if (!byPos[player.pos]) byPos[player.pos] = [];
      byPos[player.pos].push(player);
    });
    Object.keys(byPos).forEach((pos) => {
      byPos[pos].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    });
    const used = new Set();
    const starters = [];

    function take(pos, slot, count) {
      const pool = byPos[pos] || [];
      let got = 0;
      pool.forEach((player) => {
        if (got >= count || used.has(player.name)) return;
        used.add(player.name);
        starters.push({ player, slot });
        got += 1;
      });
    }

    function takeFlex(positions, slot, count) {
      const pool = [];
      positions.forEach((pos) => {
        (byPos[pos] || []).forEach((player) => {
          if (!used.has(player.name)) pool.push(player);
        });
      });
      pool.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
      pool.slice(0, count).forEach((player) => {
        used.add(player.name);
        starters.push({ player, slot });
      });
    }

    take("QB", "QB", rules.QB || 0);
    take("RB", "RB", rules.RB || 0);
    take("WR", "WR", rules.WR || 0);
    take("TE", "TE", rules.TE || 0);
    takeFlex(["RB", "WR", "TE"], "FLEX", rules.RWT || 0);
    take("DL", "DL", rules.DL || 0);
    take("LB", "LB", rules.LB || 0);
    take("DB", "DB", rules.DB || 0);
    takeFlex(["DL", "LB", "DB"], "IDP", rules.ID || 0);

    const slotOf = {};
    let total = 0;
    starters.forEach((row) => {
      slotOf[row.player.name] = row.slot;
      total += row.player.value;
    });
    return { starters, starterNames: new Set(Object.keys(slotOf)), total, slotOf };
  }

  function applyTrade(base, sendNames, incoming) {
    const drop = new Set(sendNames);
    const next = base.filter((player) => !drop.has(player.name));
    incoming.forEach((player) => next.push(player));
    return next;
  }

  function sidePack(names, dollars) {
    const players = names.map((name) => {
      const fromRoster = findOnAnyRoster(name);
      const valued = lookup(name);
      return {
        name,
        pos: fromRoster ? fromRoster.pos : (valued && valued.position) || "?",
        ir: fromRoster ? fromRoster.ir : false,
        value: valued ? Number(valued.value) || 0 : 0,
        ppg: valued ? valued.ppg : null,
        nflTeam: valued ? valued.nflTeam : "",
        injury: valued ? valued.injury || "" : "",
        unvalued: !valued
      };
    });
    const playerSum = players.reduce((sum, player) => sum + player.value, 0);
    const faabPts = Math.max(0, dollars) * pointsPerDollar();
    return {
      players,
      playerSum,
      faabDollars: Math.max(0, dollars),
      faabPts,
      total: playerSum + faabPts
    };
  }

  function findOnRoster(teamId, name) {
    return rosterList(teamId).find((player) => player.name === name) || null;
  }

  function findOnAnyRoster(name) {
    const ids = Object.keys(state.rosters);
    for (let i = 0; i < ids.length; i += 1) {
      const found = findOnRoster(ids[i], name);
      if (found) return found;
    }
    return null;
  }

  function involvedPositions(aPlayers, bPlayers) {
    const positions = new Set();
    aPlayers.concat(bPlayers).forEach((player) => {
      if (SKILL.has(player.pos)) SKILL.forEach((pos) => positions.add(pos));
      else if (IDP.has(player.pos)) IDP.forEach((pos) => positions.add(pos));
      else if (player.pos) positions.add(player.pos);
    });
    return POS_ORDER.filter((pos) => positions.has(pos));
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    const teamIds = new Set(state.teams.map((team) => team.id));
    const a = params.get("a") || "";
    const b = params.get("b") || "";
    state.a = teamIds.has(a) ? a : "";
    state.b = teamIds.has(b) ? b : "";
    state.aSend = splitNames(params.get("as")).filter((name) => findOnRoster(state.a, name));
    state.bSend = splitNames(params.get("bs")).filter((name) => findOnRoster(state.b, name));
    state.aFaab = clampFaab(state.a, params.get("ad"));
    state.bFaab = clampFaab(state.b, params.get("bd"));
  }

  function splitNames(value) {
    if (!value) return [];
    const seen = new Set();
    return value.split("|").map((part) => part.trim()).filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }

  function clampFaab(teamId, raw) {
    const n = Math.max(0, Math.round(Number(raw) || 0));
    if (!teamId) return 0;
    return Math.min(n, faabLeft(teamId));
  }

  function writeUrl() {
    const params = new URLSearchParams();
    if (state.a) params.set("a", state.a);
    if (state.b) params.set("b", state.b);
    if (state.aSend.length) params.set("as", state.aSend.join("|"));
    if (state.bSend.length) params.set("bs", state.bSend.join("|"));
    if (state.aFaab) params.set("ad", String(state.aFaab));
    if (state.bFaab) params.set("bd", String(state.bFaab));
    const query = params.toString();
    const next = query ? `${location.pathname}?${query}` : location.pathname;
    if (`${location.pathname}${location.search}` !== next) {
      history.replaceState(null, "", next);
    }
  }

  function sameClub() {
    return state.a && state.a === state.b;
  }

  function hasDeal() {
    return !sameClub() && (state.aSend.length || state.bSend.length || state.aFaab || state.bFaab);
  }

  function fairBand(aTotal, bTotal) {
    return Math.max(8, 0.08 * Math.max(aTotal, bTotal, 30));
  }

  function explain(ctx) {
    const sentences = [];
    const band = fairBand(ctx.aRecv, ctx.bRecv);
    const gap = Math.abs(ctx.netA);
    if (!hasDeal()) {
      return "Add at least one player or some FAAB to see who wins.";
    }
    if (gap < band) {
      sentences.push(`${ctx.nameA} and ${ctx.nameB} are ${fmt(gap)} points apart. That is a fair trade.`);
    } else if (ctx.netA > 0) {
      sentences.push(`${ctx.nameA} wins by ${fmt(gap)} points.`);
    } else {
      sentences.push(`${ctx.nameB} wins by ${fmt(gap)} points.`);
    }

    const pieces = ctx.aPack.players.map((player) => Object.assign({ from: ctx.nameA, to: ctx.nameB, toLine: ctx.bAfter }, player))
      .concat(ctx.bPack.players.map((player) => Object.assign({ from: ctx.nameB, to: ctx.nameA, toLine: ctx.aAfter }, player)));
    if (pieces.length) {
      const best = pieces.slice().sort((a, b) => b.value - a.value)[0];
      const fromCount = best.from === ctx.nameA ? ctx.aPack.players.length : ctx.bPack.players.length;
      const toCount = best.from === ctx.nameA ? ctx.bPack.players.length : ctx.aPack.players.length;
      let line = `${best.from} gives up the best player, ${best.name}.`;
      if (fromCount === 1 && toCount >= 2) {
        line += ` ${best.to} sends ${toCount} players back, so this is a stud-for-depth trade.`;
      } else if (toCount === 1 && fromCount >= 2) {
        line += ` ${best.from} is sending depth for one player.`;
      }
      const lands = best.toLine.slotOf[best.name];
      if (lands) line += ` ${best.name} would start (${lands}) for ${best.to}.`;
      else line += ` ${best.name} would land on the bench for ${best.to}.`;
      sentences.push(line);
    }

    const aDelta = ctx.aAfter.total - ctx.aBefore.total;
    const bDelta = ctx.bAfter.total - ctx.bBefore.total;
    if (pieces.length && (Math.abs(aDelta) >= 5 || Math.abs(bDelta) >= 5)) {
      sentences.push(
        `On the starting lineup, ${ctx.nameA} ${deltaWords(aDelta)} and ${ctx.nameB} ${deltaWords(bDelta)}.`
      );
    }

    const faabBits = [];
    if (ctx.aPack.faabDollars >= 1) {
      faabBits.push(`${ctx.nameA} sends $${ctx.aPack.faabDollars} (about ${fmt(ctx.aPack.faabPts)} points)`);
    }
    if (ctx.bPack.faabDollars >= 1) {
      faabBits.push(`${ctx.nameB} sends $${ctx.bPack.faabDollars} (about ${fmt(ctx.bPack.faabPts)} points)`);
    }
    if (faabBits.length) sentences.push(`${faabBits.join(", and ")}.`);
    return sentences.join(" ");
  }

  function deltaWords(delta) {
    if (delta > 0.05) return `gets ${fmt(delta)} better`;
    if (delta < -0.05) return `gets ${fmt(Math.abs(delta))} worse`;
    return "stays about the same";
  }

  function toneOf(netA, aRecv, bRecv) {
    const band = fairBand(aRecv, bRecv);
    const gap = Math.abs(netA);
    if (gap < band) return { tone: "fair", label: "Fair" };
    if (gap < band * 2.2) return { tone: "edge", label: "Slight edge" };
    return { tone: "clear", label: "Clear win" };
  }

  function render() {
    document.getElementById("tcSides").hidden = false;
    renderSide("a", "tcSideA");
    renderSide("b", "tcSideB");
    renderVerdict();
    renderRosters();
    writeUrl();
  }

  function renderSide(which, hostId) {
    const host = document.getElementById(hostId);
    const teamId = state[which];
    const other = which === "a" ? state.b : state.a;
    const send = state[which === "a" ? "aSend" : "bSend"];
    const faab = state[which === "a" ? "aFaab" : "bFaab"];
    const options = state.teams.map((team) => {
      const selected = team.id === teamId ? " selected" : "";
      const disabled = team.id === other ? " disabled" : "";
      return `<option value="${esc(team.id)}"${selected}${disabled}>${esc(team.name)}</option>`;
    }).join("");
    const team = teamById(teamId);
    const mark = team ? window.WUC.teamMark(team.id, { size: "md" }) : "";
    const meta = team
      ? `${esc(team.owner || "")}${team.record ? ` · ${esc(team.record)}` : ""} · $${faabLeft(teamId)} FAAB left`
      : "Choose a club.";
    const added = send.map((name) => playerRow(findOnRoster(teamId, name) || { name, pos: "?", value: 0, unvalued: true }, which)).join("");
    const pickerOpen = state.openPicker === which;
    const queryValue = "";

    host.innerHTML = `
      <div class="tc-side-head">
        <div>
          <label class="tc-label" for="tcTeam-${which}">${which === "a" ? "Team A" : "Team B"}</label>
          <select id="tcTeam-${which}" class="tc-select">${options ? `<option value="">Select a team</option>${options}` : ""}</select>
          <p class="tc-meta">${mark}${meta}</p>
        </div>
      </div>
      <label class="tc-label" for="tcSearch-${which}">Add a player</label>
      <div class="tc-picker">
        <input id="tcSearch-${which}" class="tc-search" type="search" placeholder="${teamId ? "Search this roster" : "Pick a team first"}" ${teamId ? "" : "disabled"} autocomplete="off" role="combobox" aria-expanded="${pickerOpen ? "true" : "false"}" aria-controls="tcList-${which}" value="${esc(queryValue)}" />
        <ul class="tc-results" id="tcList-${which}" role="listbox" ${pickerOpen ? "" : "hidden"}>${pickerOpen ? resultItems(which, queryValue) : ""}</ul>
      </div>
      <ul class="tc-added">${added || `<li class="tc-empty">Nobody added yet.</li>`}</ul>
      <label class="tc-label" for="tcFaab-${which}">FAAB included <span class="tc-optional">optional</span></label>
      <div class="tc-faab">
        <span class="tc-dollar" aria-hidden="true">$</span>
        <input id="tcFaab-${which}" class="tc-faab-input" inputmode="numeric" type="number" min="0" max="${teamId ? faabLeft(teamId) : 0}" step="1" value="${faab}" ${teamId ? "" : "disabled"} />
        <span class="tc-faab-worth">${faab ? `about ${fmt(faab * pointsPerDollar())} pts` : ""}</span>
      </div>
    `;
    const search = host.querySelector(".tc-search");
    if (search && queryValue) search.value = queryValue;
  }

  function resultItems(which, query) {
    const teamId = state[which];
    if (!teamId) return "";
    const send = new Set(state[which === "a" ? "aSend" : "bSend"]);
    const needle = normName(query);
    let rows = rosterList(teamId).filter((player) => !send.has(player.name));
    if (needle) {
      rows = rows.filter((player) => normName(player.name).includes(needle) || player.pos.toLowerCase().includes(needle));
    }
    rows.sort((a, b) => POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos) || b.value - a.value || a.name.localeCompare(b.name));
    if (!rows.length) return `<li class="tc-empty">No match on this roster.</li>`;
    return rows.map((player) => `
      <li>
        <button type="button" class="tc-result" data-add="${esc(which)}" data-name="${esc(player.name)}">
          ${playerBits(player)}
        </button>
      </li>
    `).join("");
  }

  function playerBits(player) {
    const injury = player.injury ? `<span class="tc-flag">${esc(player.injury)}</span>` : "";
    const ir = player.ir ? `<span class="tc-flag">IR</span>` : "";
    const score = player.unvalued
      ? `<span class="tc-novalue">No 2026 score</span>`
      : `<span class="tc-val">${fmt(player.value)}</span>`;
    const sub = player.unvalued
      ? esc(player.pos)
      : `${esc(player.nflTeam || "FA")} · ${fmt(player.ppg)} PPG · ${player.games}g`;
    return `
      <span class="tc-pos">${esc(player.pos)}</span>
      <span class="tc-who">
        <span class="tc-pname">${esc(player.name)} ${ir}${injury}</span>
        <span class="tc-psub">${sub}</span>
      </span>
      ${score}
    `;
  }

  function playerRow(player, which) {
    return `
      <li class="tc-chip-row">
        ${playerBits(player)}
        <button type="button" class="tc-remove" data-remove="${esc(which)}" data-name="${esc(player.name)}" aria-label="Remove ${esc(player.name)}">×</button>
      </li>
    `;
  }

  function renderVerdict() {
    const host = document.getElementById("tcVerdict");
    if (!state.a || !state.b || sameClub()) {
      host.hidden = false;
      host.innerHTML = `<h2>The verdict</h2><p>${sameClub() ? "Pick two different clubs." : "Pick Team A and Team B to start."}</p>`;
      return;
    }
    const ctx = buildContext();
    if (!hasDeal()) {
      host.hidden = false;
      host.innerHTML = `<h2>The verdict</h2><p>Add players or FAAB from either side. The link in the address bar updates as you go, so you can text it to the league.</p>`;
      return;
    }
    const tone = toneOf(ctx.netA, ctx.aRecv, ctx.bRecv);
    const scale = fairBand(ctx.aRecv, ctx.bRecv) * 3;
    const tilt = scale ? Math.max(-1, Math.min(1, ctx.netA / scale)) : 0;
    const knob = 50 - tilt * 42;
    const winnerColor = ctx.netA >= 0
      ? (teamById(state.a).color || "#69BE28")
      : (teamById(state.b).color || "#69BE28");
    const fillStyle = knob < 50
      ? `left:${knob}%;width:${50 - knob}%;background:${winnerColor}`
      : `left:50%;width:${knob - 50}%;background:${winnerColor}`;
    host.hidden = false;
    host.innerHTML = `
      <h2>The verdict</h2>
      <div class="tc-packages">
        <div>
          <p class="tc-pack-label">${esc(ctx.nameA)} receives</p>
          <p class="tc-pack-num">${fmt(ctx.aRecv)}</p>
        </div>
        <div>
          <p class="tc-pack-label">${esc(ctx.nameB)} receives</p>
          <p class="tc-pack-num">${fmt(ctx.bRecv)}</p>
        </div>
      </div>
      <div class="tc-meter" role="img" aria-label="${esc(tone.label)}. ${esc(explain(ctx))}">
        <div class="tc-meter-names">
          <span>${esc(teamById(state.a).abbrev || ctx.nameA)}</span>
          <span class="tc-tone tc-tone-${tone.tone}">${esc(tone.label)}</span>
          <span>${esc(teamById(state.b).abbrev || ctx.nameB)}</span>
        </div>
        <div class="tc-meter-track">
          <span class="tc-meter-fill" style="${fillStyle}"></span>
          <span class="tc-meter-mid"></span>
          <span class="tc-meter-knob" style="left:${knob}%"></span>
        </div>
      </div>
      <p class="tc-plain">${esc(explain(ctx))}</p>
      <div class="tc-share">
        <button type="button" class="btn btn-primary" id="tcCopy">Copy link</button>
        <p class="tc-copy-note" id="tcCopyNote" role="status"></p>
      </div>
    `;
  }

  function buildContext() {
    const aPack = sidePack(state.aSend, state.aFaab);
    const bPack = sidePack(state.bSend, state.bFaab);
    const aBase = rosterList(state.a);
    const bBase = rosterList(state.b);
    const aNext = applyTrade(aBase, state.aSend, bPack.players);
    const bNext = applyTrade(bBase, state.bSend, aPack.players);
    const aBefore = optimize(aBase);
    const aAfter = optimize(aNext);
    const bBefore = optimize(bBase);
    const bAfter = optimize(bNext);
    return {
      nameA: teamById(state.a).name,
      nameB: teamById(state.b).name,
      aPack,
      bPack,
      aRecv: bPack.total,
      bRecv: aPack.total,
      netA: bPack.total - aPack.total,
      aBase,
      bBase,
      aNext,
      bNext,
      aBefore,
      aAfter,
      bBefore,
      bAfter
    };
  }

  function renderRosters() {
    const host = document.getElementById("tcRosters");
    if (!state.a || !state.b || sameClub() || (!state.aSend.length && !state.bSend.length)) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    const ctx = buildContext();
    const positions = involvedPositions(ctx.aPack.players, ctx.bPack.players);
    host.hidden = false;
    host.innerHTML = `
      <h2>Rosters, before and after</h2>
      <p>Starters follow the league lineup: 1 QB, 1 RB, 1 WR, 1 TE, 3 flex, 1 DL, 1 LB, 2 DB, 3 IDP flex. IR players cannot start. A flex change can shuffle the other spots in that group, so those positions are shown too.</p>
      ${rosterBlock(ctx.nameA, ctx.aBase, ctx.aNext, ctx.aBefore, ctx.aAfter, positions)}
      ${rosterBlock(ctx.nameB, ctx.bBase, ctx.bNext, ctx.bBefore, ctx.bAfter, positions)}
    `;
  }

  function rosterBlock(name, beforePlayers, afterPlayers, beforeLine, afterLine, positions) {
    const delta = afterLine.total - beforeLine.total;
    const sign = delta > 0 ? "+" : "";
    return `
      <article class="tc-club">
        <h3>${esc(name)}</h3>
        <p class="tc-line-delta">Starting lineup value ${fmt(beforeLine.total)} → ${fmt(afterLine.total)} <strong>(${sign}${fmt(delta)})</strong></p>
        ${positions.map((pos) => posBlock(pos, beforePlayers, afterPlayers, beforeLine, afterLine)).join("")}
      </article>
    `;
  }

  function posBlock(pos, beforePlayers, afterPlayers, beforeLine, afterLine) {
    return `
      <div class="tc-posblock">
        <h4>${esc(pos)}</h4>
        <div class="tc-ba">
          ${rosterCol("Before", beforePlayers, beforeLine, pos)}
          ${rosterCol("After", afterPlayers, afterLine, pos)}
        </div>
      </div>
    `;
  }

  function rosterCol(label, players, line, pos) {
    const rows = players
      .filter((player) => player.pos === pos)
      .slice()
      .sort((a, b) => {
        const aStart = line.slotOf[a.name] ? 1 : 0;
        const bStart = line.slotOf[b.name] ? 1 : 0;
        return bStart - aStart || b.value - a.value || a.name.localeCompare(b.name);
      });
    const body = rows.length
      ? rows.map((player) => {
          const slot = line.slotOf[player.name];
          const badge = player.ir ? `<span class="tc-badge tc-badge-ir">IR</span>` : slot ? `<span class="tc-badge">${esc(slot)}</span>` : `<span class="tc-badge tc-badge-bench">Bench</span>`;
          return `<li><span class="tc-rname">${esc(player.name)}</span>${badge}<span class="tc-rval">${player.unvalued ? "—" : fmt(player.value)}</span></li>`;
        }).join("")
      : `<li class="tc-empty">Empty</li>`;
    return `<div><p class="tc-col-label">${label}</p><ul class="tc-rlist">${body}</ul></div>`;
  }

  function onClick(event) {
    const add = event.target.closest("[data-add]");
    if (add) {
      addName(add.getAttribute("data-add"), add.getAttribute("data-name"));
      return;
    }
    const remove = event.target.closest("[data-remove]");
    if (remove) {
      removeName(remove.getAttribute("data-remove"), remove.getAttribute("data-name"));
      return;
    }
    if (event.target.id === "tcCopy") {
      copyLink();
      return;
    }
    if (!event.target.closest(".tc-picker")) state.openPicker = "";
  }

  function addName(which, name) {
    if (!name) return;
    const key = which === "a" ? "aSend" : "bSend";
    if (state[key].includes(name)) return;
    if (!findOnRoster(state[which], name)) return;
    state[key].push(name);
    state.openPicker = "";
    render();
  }

  function removeName(which, name) {
    const key = which === "a" ? "aSend" : "bSend";
    state[key] = state[key].filter((item) => item !== name);
    render();
  }

  function onChange(event) {
    if (event.target.id === "tcTeam-a" || event.target.id === "tcTeam-b") {
      const which = event.target.id.endsWith("a") ? "a" : "b";
      state[which] = event.target.value;
      state[which === "a" ? "aSend" : "bSend"] = [];
      state[which === "a" ? "aFaab" : "bFaab"] = 0;
      state.openPicker = "";
      render();
    }
  }

  function onInput(event) {
    if (event.target.classList.contains("tc-search")) {
      const which = event.target.id.endsWith("a") ? "a" : "b";
      state.openPicker = which;
      const list = document.getElementById(`tcList-${which}`);
      if (list) {
        list.hidden = false;
        list.innerHTML = resultItems(which, event.target.value);
      }
      event.target.setAttribute("aria-expanded", "true");
      return;
    }
    if (event.target.classList.contains("tc-faab-input")) {
      const which = event.target.id.endsWith("a") ? "a" : "b";
      state[which === "a" ? "aFaab" : "bFaab"] = clampFaab(state[which], event.target.value);
      event.target.value = String(state[which === "a" ? "aFaab" : "bFaab"]);
      renderVerdict();
      writeUrl();
      const worth = event.target.parentElement.querySelector(".tc-faab-worth");
      const dollars = state[which === "a" ? "aFaab" : "bFaab"];
      if (worth) worth.textContent = dollars ? `about ${fmt(dollars * pointsPerDollar())} pts` : "";
    }
  }

  function onFocus(event) {
    if (event.target.classList.contains("tc-faab-input")) {
      event.target.select();
      return;
    }
    if (!event.target.classList.contains("tc-search")) return;
    const which = event.target.id.endsWith("a") ? "a" : "b";
    state.openPicker = which;
    const list = document.getElementById(`tcList-${which}`);
    if (list) {
      list.hidden = false;
      list.innerHTML = resultItems(which, event.target.value);
    }
    event.target.setAttribute("aria-expanded", "true");
  }

  function copyLink() {
    const note = document.getElementById("tcCopyNote");
    const done = (ok) => {
      if (note) note.textContent = ok ? "Link copied." : "Copy failed. Select the address bar instead.";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(location.href).then(() => done(true)).catch(() => done(false));
    } else {
      done(false);
    }
  }

  function showError(message) {
    const el = document.getElementById("tcError");
    el.hidden = false;
    el.textContent = message;
  }

  function fillHow() {
    const values = state.values || {};
    const faab = values.faab || {};
    const host = document.getElementById("tcHow");
    host.innerHTML = `
      <p>${esc(values.method || "")}</p>
      <p>${esc(faab.note || "")}</p>
      <p>Values updated ${esc(values.asOf || "")}, through week ${esc(values.weekThrough || "")}. ${esc((values.lineup && values.lineup.source) || "")}</p>
    `;
    const asOf = document.getElementById("tcAsOf");
    asOf.textContent = values.asOf
      ? `Values through week ${values.weekThrough}, updated ${values.asOf}. One FAAB dollar ≈ ${fmt(faab.pointsPerDollar || 0)} points.`
      : "";
  }

  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("input", onInput);
  document.addEventListener("focusin", onFocus);
  window.addEventListener("popstate", () => {
    readUrl();
    render();
  });

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await window.WUC.loadTeamColors();
      const [teamsDoc, values] = await Promise.all([
        window.WUC.loadJSON("data/teams.json"),
        window.WUC.loadJSON("data/player-values.json")
      ]);
      state.teams = (teamsDoc.teams || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      state.values = values;
      if (!values || !values.lineup || !Array.isArray(values.players)) {
        showError("Player values are missing the lineup rules. The calculator cannot guess them.");
        return;
      }
      (values.players || []).forEach((player) => {
        [player.name].concat(player.aliases || []).forEach((alias) => {
          const key = normName(alias);
          const prev = state.byKey.get(key);
          if (!prev || (player.games || 0) > (prev.games || 0)) state.byKey.set(key, player);
        });
      });
      await Promise.all(state.teams.map(async (team) => {
        state.rosters[team.id] = await window.WUC.loadJSON(`data/rosters/${team.id}.json`);
      }));
      fillHow();
      readUrl();
      render();
    } catch (err) {
      showError("Could not load teams, rosters, or player values. Refresh the page.");
    }
  });
})();

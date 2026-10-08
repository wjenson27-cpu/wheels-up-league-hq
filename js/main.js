/* Shared nav, footer, helpers */
(function () {
  const PRIMARY = [
    { href: "index.html", label: "Home" },
    { href: "standings.html", label: "Standings" },
    { href: "rankings.html", label: "Rankings" },
    { href: "rosters.html", label: "Rosters" },
    { href: "trades.html", label: "Trades" },
    { href: "faab.html", label: "FAAB" }
  ];

  const MORE = [
    { href: "awards.html", label: "Awards" },
    { href: "recap.html", label: "Recap" },
    { href: "history.html", label: "Archives" },
    { href: "archives.html", label: "2014–2025" },
    { href: "podcast.html", label: "Podcast" },
    { href: "scoring.html", label: "Scoring" },
    { href: "td-parlay.html", label: "TD Parlay" }
  ];

  const PAGES = [...PRIMARY, ...MORE];

  const BRAND_MARK = `<span class="brand-mark" aria-hidden="true"><img src="img/wu-mark.png" width="36" height="36" alt=""></span>`;

  function currentPage() {
    const path = (location.pathname || "").split("/").pop() || "index.html";
    const file = path === "" ? "index.html" : path;
    return file === "team.html" ? "rosters.html" : file;
  }

  function buildNav() {
    const cur = currentPage();
    const primaryLinks = PRIMARY.map(
      (p) =>
        `<li><a href="${p.href}" class="${p.href === cur ? "active" : ""}"${p.href === cur ? ' aria-current="page"' : ""}>${p.label}</a></li>`
    ).join("");
    const moreActive = MORE.some((p) => p.href === cur);
    const moreLinks = MORE.map(
      (p) =>
        `<li><a href="${p.href}" class="${p.href === cur ? "active" : ""}"${p.href === cur ? ' aria-current="page"' : ""}>${p.label}</a></li>`
    ).join("");

    return `
<header class="site-header">
  <div class="nav-inner">
    <a class="brand" href="index.html">
      ${BRAND_MARK}
      <span>Wheels Up</span>
    </a>
    <button type="button" class="nav-toggle" id="navToggle" aria-expanded="false" aria-controls="navLinks">Menu</button>
    <ul class="nav-links" id="navLinks">
      ${primaryLinks}
      <li class="nav-more${moreActive ? " has-active" : ""}">
        <button type="button" class="nav-more-btn" id="navMoreBtn" aria-expanded="false" aria-haspopup="true" aria-controls="navMoreMenu">More</button>
        <ul class="nav-more-menu" id="navMoreMenu">${moreLinks}</ul>
      </li>
    </ul>
  </div>
</header>`;
  }

  function buildFooter() {
    const cfg = window.WUC_CONFIG || {};
    const fan = cfg.fantraxUrl || "#";
    return `
<footer class="site-footer">
  <p><strong>Wheels Up Collective</strong> · 14-team IDP · TE premium · Fantrax · WWJDD</p>
  <p><a href="${fan}" target="_blank" rel="noopener">Open league on Fantrax</a>
    · <a href="standings.html">Standings</a>
    · <a href="scoring.html">Scoring</a>
    · <a href="podcast.html">Podcast</a></p>
  <p class="dim">Commish: ${cfg.commissioner || (cfg.commissioners || [])[0] || "—"}</p>
  <p class="site-meta visit-count">Visits <strong id="visit-count">…</strong></p>
</footer>`;
  }

  function ensureA11y() {
    if (!document.querySelector(".skip-link")) {
      const skip = document.createElement("a");
      skip.className = "skip-link";
      skip.href = "#main-content";
      skip.textContent = "Skip to content";
      document.body.insertBefore(skip, document.body.firstChild);
    }
    const main = document.querySelector("main");
    if (main && !main.id) main.id = "main-content";
    const skip = document.querySelector(".skip-link");
    if (skip && main && main.id) skip.href = "#" + main.id;
    if (!document.querySelector('link[rel="icon"]')) {
      const icon = document.createElement("link");
      icon.rel = "icon";
      icon.href = "img/wu-mark.png";
      icon.type = "image/png";
      document.head.appendChild(icon);
    }
  }

  function isLocalPreview() {
    const host = String(location.hostname || "");
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "";
  }

  function mountAnalytics() {
    if (isLocalPreview()) return;
    if (document.querySelector("script[data-cf-beacon]")) return;
    const beacon = document.createElement("script");
    beacon.type = "module";
    beacon.defer = true;
    beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
    beacon.setAttribute("data-cf-beacon", '{"token": "979ed6d735ee4ae1a6fe313fb2ae3b53"}');
    document.body.appendChild(beacon);
  }

  function mountChrome() {
    ensureA11y();
    const navHost = document.getElementById("site-nav");
    const footHost = document.getElementById("site-footer");
    if (navHost) navHost.innerHTML = buildNav();
    if (footHost) footHost.innerHTML = buildFooter();
    const visitEl = document.getElementById("visit-count");
    if (visitEl) {
      if (isLocalPreview()) {
        visitEl.textContent = "—";
      } else {
        fetch("https://abacus.jasoncameron.dev/hit/wheels-up-league-hq/visits")
          .then((r) => r.json())
          .then((d) => {
            visitEl.textContent = Number(d && d.value != null ? d.value : 0).toLocaleString("en-US");
          })
          .catch(() => { visitEl.textContent = "—"; });
      }
    }
    mountAnalytics();

    const toggle = document.getElementById("navToggle");
    const links = document.getElementById("navLinks");
    if (toggle && links) {
      toggle.addEventListener("click", () => {
        const open = links.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
      links.addEventListener("click", (ev) => {
        if (ev.target.closest("a")) {
          links.classList.remove("open");
          toggle.setAttribute("aria-expanded", "false");
        }
      });
    }
    const moreBtn = document.getElementById("navMoreBtn");
    const moreItem = moreBtn && moreBtn.closest(".nav-more");
    if (moreBtn && moreItem) {
      moreBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const open = moreItem.classList.toggle("open");
        moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      document.addEventListener("click", (ev) => {
        if (!moreItem.contains(ev.target)) {
          moreItem.classList.remove("open");
          moreBtn.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
          moreItem.classList.remove("open");
          moreBtn.setAttribute("aria-expanded", "false");
          if (links) links.classList.remove("open");
          if (toggle) toggle.setAttribute("aria-expanded", "false");
        }
      });
    }
  }


  let teamColors = null;
  async function loadTeamColors() {
    if (teamColors) return teamColors;
    try {
      const data = await loadJSON("data/teams.json");
      teamColors = Object.fromEntries((data.teams || []).map((t) => {
        const copy = Object.assign({}, t);
        if (!copy.logo && copy.id) copy.logo = "img/logos/" + copy.id + ".jpg";
        return [t.id, copy];
      }));
    } catch (e) {
      teamColors = {};
    }
    return teamColors;
  }

  function teamChip(teamId, opts = {}) {
    const t = (teamColors || {})[teamId] || {};
    const color = t.color || "#69BE28";
    const abbrev = escapeHtml(t.abbrev || String(teamId || "?").slice(0, 3).toUpperCase());
    const size = opts.size || "md";
    const title = escapeHtml(t.name || teamId || "");
    return `<span class="team-chip team-chip-${size}" style="--team-color:${color}" title="${title}"><span class="team-chip-mark">${abbrev}</span></span>`;
  }

  /** Logo img when the club resolves, else color chip. Accepts a team object or an id/name. */
  function teamMark(teamOrId, opts = {}) {
    let key = typeof teamOrId === "string" ? teamOrId : ((teamOrId && teamOrId.id) || "");
    if (typeof teamOrId === "string" && !(teamColors && teamColors[key]) && window.WUC && typeof WUC.resolveTeamId === "function") {
      const resolved = WUC.resolveTeamId(key);
      if (resolved) key = resolved;
    }
    const fromColors = (teamColors || {})[key] || null;
    const t = fromColors || (typeof teamOrId === "object" && teamOrId ? teamOrId : { id: key });
    const id = t.id || key;
    const size = opts.size || "md";
    const color = t.color || "#69BE28";
    const title = escapeHtml(t.name || id || "");
    const alt = escapeHtml(t.name || t.abbrev || id || "team");
    const safeId = /^[a-z0-9-]{1,40}$/.test(String(id || "")) ? String(id) : "";
    const logo = t.logo || (safeId ? `img/logos/${safeId}.jpg` : "");
    if (logo) {
      return `<span class="team-mark team-mark-${size}" data-team="${escapeHtml(safeId || id)}" data-size="${escapeHtml(size)}" style="--team-color:${color}" title="${title}"><img class="team-logo" src="${escapeHtml(logo)}" alt="${alt}" loading="lazy" width="44" height="44" /></span>`;
    }
    return teamChip(id, opts);
  }

  async function loadJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso + (iso.length <= 10 ? "T12:00:00" : ""));
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Los_Angeles"
      });
    } catch {
      return iso;
    }
  }

  function podcastUrl() {
    const c = window.WUC_CONFIG || {};
    return c.PODCAST_URL || c.podcastUrl || "";
  }

  /** Spotify show embed from open.spotify.com/show/{id} */
  function spotifyEmbedHtml(url) {
    if (!url) return "";
    const m = url.match(/open\.spotify\.com\/show\/([a-zA-Z0-9]+)/);
    if (!m) {
      return `<p><a class="btn btn-primary" href="${escapeHtml(url)}" target="_blank" rel="noopener">Listen on Spotify</a></p>`;
    }
    const id = m[1];
    return `<div class="podcast-embed-wrap">
<iframe style="border-radius:12px" src="https://open.spotify.com/embed/show/${id}?utm_source=generator&theme=0"
  width="100%" height="232" frameBorder="0" allowfullscreen=""
  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"
  title="Wheels Up Collective Podcast"></iframe>
</div>`;
  }

  window.WUC = {
    loadJSON,
    loadTeamColors,
    teamChip,
    teamMark,
    getTeam: (id) => (teamColors || {})[id] || {},
    get teamColors() { return teamColors || {}; },
    escapeHtml,
    formatDate,
    podcastUrl,
    spotifyEmbedHtml,
    mountChrome
  };

  document.addEventListener("DOMContentLoaded", mountChrome);
})();

/* Shared nav, footer, helpers */
(function () {
  const PAGES = [
    { href: "index.html", label: "Home" },
    { href: "rosters.html", label: "Rosters" },
    { href: "trades.html", label: "Trades" },
    { href: "faab.html", label: "FAAB" },
    { href: "td-parlay.html", label: "TD Parlay" },
    { href: "recap.html", label: "Recap" },
    { href: "rankings.html", label: "Rankings" },
    { href: "history.html", label: "History" },
    { href: "podcast.html", label: "Podcast" },
    { href: "scoring.html", label: "Scoring" }
  ];

  function currentPage() {
    const path = (location.pathname || "").split("/").pop() || "index.html";
    return path === "" ? "index.html" : path;
  }

  function buildNav() {
    const cur = currentPage();
    const links = PAGES.map(
      (p) =>
        `<li><a href="${p.href}" class="${p.href === cur ? "active" : ""}">${p.label}</a></li>`
    ).join("");

    return `
<header class="site-header">
  <div class="nav-inner">
    <a class="brand" href="index.html">
      <span class="brand-mark" aria-hidden="true">🦅</span>
      <span>Wheels Up</span>
    </a>
    <button type="button" class="nav-toggle" id="navToggle" aria-expanded="false" aria-controls="navLinks">Menu</button>
    <ul class="nav-links" id="navLinks">${links}</ul>
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
    · <a href="scoring.html">Scoring</a>
    · <a href="podcast.html">Podcast</a></p>
  <p class="dim">Commish: ${cfg.commissioner || (cfg.commissioners || [])[0] || "—"}</p>
</footer>`;
  }

  function mountChrome() {
    const navHost = document.getElementById("site-nav");
    const footHost = document.getElementById("site-footer");
    if (navHost) navHost.innerHTML = buildNav();
    if (footHost) footHost.innerHTML = buildFooter();

    const toggle = document.getElementById("navToggle");
    const links = document.getElementById("navLinks");
    if (toggle && links) {
      toggle.addEventListener("click", () => {
        const open = links.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
  }


  let teamColors = null;
  async function loadTeamColors() {
    if (teamColors) return teamColors;
    try {
      const data = await loadJSON("data/teams.json");
      teamColors = Object.fromEntries((data.teams || []).map((t) => [t.id, t]));
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
    get teamColors() { return teamColors || {}; },
    escapeHtml,
    formatDate,
    podcastUrl,
    spotifyEmbedHtml,
    mountChrome
  };

  document.addEventListener("DOMContentLoaded", mountChrome);
})();

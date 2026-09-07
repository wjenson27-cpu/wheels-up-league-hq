/* Smack talk board — localStorage demo only */
(function () {
  const KEY = "wuc_smack_posts_v2";
  const SEEDS = [
    {
      id: "seed-1",
      name: "ThiccSwede",
      body: "Week 1 projections are public. If your club is 14th on paper, start living on the waiver wire.",
      ts: Date.now() - 1000 * 60 * 60 * 36
    },
    {
      id: "seed-2",
      name: "Indian Trail Slumlords",
      body: "Highest Fantrax projection. Statement game incoming. Bring the IDP.",
      ts: Date.now() - 1000 * 60 * 60 * 20
    },
    {
      id: "seed-3",
      name: "Pocket Agents",
      body: "Barton still on the block. Who wants to deal before kickoff?",
      ts: Date.now() - 1000 * 60 * 60 * 8
    }
  ];

  function loadPosts() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        localStorage.setItem(KEY, JSON.stringify(SEEDS));
        return SEEDS.slice();
      }
      return JSON.parse(raw);
    } catch {
      return SEEDS.slice();
    }
  }

  function savePosts(posts) {
    localStorage.setItem(KEY, JSON.stringify(posts));
  }

  function render() {
    const list = document.getElementById("smackList");
    if (!list) return;
    const posts = loadPosts().sort((a, b) => b.ts - a.ts);
    if (!posts.length) {
      list.innerHTML = `<p class="muted">No posts yet. Be the first to talk smack.</p>`;
      return;
    }
    list.innerHTML = posts
      .map((p) => {
        const when = new Date(p.ts).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/Los_Angeles"
        });
        return `<article class="smack-post">
  <div><span class="who">${WUC.escapeHtml(p.name)}</span><span class="when">${when} PT</span></div>
  <p class="body">${WUC.escapeHtml(p.body)}</p>
</article>`;
      })
      .join("");
  }

  function init() {
    const form = document.getElementById("smackForm");
    const clearBtn = document.getElementById("clearSmack");
    render();

    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = (document.getElementById("smackName") || {}).value.trim();
        const body = (document.getElementById("smackBody") || {}).value.trim();
        if (!name || !body) return;
        const posts = loadPosts();
        posts.push({
          id: "p-" + Date.now(),
          name: name.slice(0, 40),
          body: body.slice(0, 800),
          ts: Date.now()
        });
        savePosts(posts);
        form.reset();
        render();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (confirm("Clear all local smack posts on this browser?")) {
          localStorage.removeItem(KEY);
          render();
        }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();

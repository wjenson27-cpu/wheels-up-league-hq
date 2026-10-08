#!/usr/bin/env node
/**
 * Lightweight site check.
 *   node scripts/check-site.mjs          JSON + static files
 *   node scripts/check-site.mjs --pages  also open every page in Chrome
 *
 * Page console failures ignore third-party noise (Cloudflare analytics,
 * the visit counter, Spotify, Google fonts).
 */
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const args = new Set(process.argv.slice(2));
const jsonOnly = args.has("--json");
const pagesOnly = args.has("--pages");
const runJson = !pagesOnly || args.has("--json") || args.size === 0;
const runPages = args.has("--pages");

const PAGES = [
  ["index.html", "/index.html"],
  ["standings.html", "/standings.html"],
  ["team.html", "/team.html"],
  ["team-eddies", "/team.html?id=eddies"],
  ["team-unknown", "/team.html?id=not-a-club"],
  ["rosters.html", "/rosters.html"],
  ["trades.html", "/trades.html"],
  ["rankings.html", "/rankings.html"],
  ["recap.html", "/recap.html"],
  ["awards.html", "/awards.html"],
  ["faab.html", "/faab.html"],
  ["td-parlay.html", "/td-parlay.html"],
  ["history.html", "/history.html"],
  ["archives.html", "/archives.html"],
  ["podcast.html", "/podcast.html"],
  ["scoring.html", "/scoring.html"]
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];

const failures = [];

function fail(msg) {
  failures.push(msg);
  console.error("FAIL", msg);
}

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function checkJson() {
  const dataDir = join(root, "data");
  const files = (await walk(dataDir)).filter((f) => f.endsWith(".json"));
  if (!files.length) fail("no JSON files under data/");
  for (const file of files) {
    const rel = relative(root, file);
    let text = "";
    try {
      text = await readFile(file, "utf8");
      JSON.parse(text);
    } catch (err) {
      fail(`${rel} is not valid JSON (${err.message})`);
      continue;
    }
    if (!text.trim()) fail(`${rel} is empty`);
  }
  console.log(`JSON ok (${files.length} files)`);

  const required = [
    "index.html", "standings.html", "team.html", "rosters.html", "trades.html",
    "rankings.html", "recap.html", "awards.html", "faab.html", "td-parlay.html",
    "history.html", "archives.html", "podcast.html", "scoring.html",
    "css/styles.css", "js/main.js", "js/config.js", "js/league.js"
  ];
  for (const rel of required) {
    try {
      const info = await stat(join(root, rel));
      if (!info.isFile()) fail(`${rel} is not a file`);
    } catch {
      fail(`missing ${rel}`);
    }
  }

  const shared = required.filter((f) => f.endsWith(".html") && f !== "archives.html");
  for (const rel of shared) {
    const html = await readFile(join(root, rel), "utf8");
    if (!html.includes("css/styles.css")) fail(`${rel} does not load css/styles.css`);
    if (!html.includes("js/main.js")) fail(`${rel} does not load js/main.js`);
    if (!html.includes('rel="icon"') && !html.includes("rel='icon'")) fail(`${rel} has no favicon`);
  }
  const leaguePages = ["index.html", "standings.html", "team.html", "rosters.html", "trades.html", "faab.html"];
  for (const rel of leaguePages) {
    const html = await readFile(join(root, rel), "utf8");
    if (!html.includes("js/league.js")) fail(`${rel} does not load js/league.js`);
  }
  const trades = await readFile(join(root, "trades.html"), "utf8");
  if (trades.includes("tradePending") || /Pending offers/i.test(trades)) {
    fail("trades.html still has a pending-offers section");
  }
}

function contentType(file) {
  const ext = extname(file).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };
  return types[ext] || "application/octet-stream";
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        let pathname = decodeURIComponent(url.pathname);
        if (pathname.endsWith("/")) pathname += "index.html";
        const file = join(root, pathname);
        if (!file.startsWith(root)) {
          res.writeHead(403);
          res.end("no");
          return;
        }
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": contentType(file) });
        res.end(body);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

function ignoreConsole(text) {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("cloudflare") ||
    t.includes("abacus.jasoncameron") ||
    t.includes("spotify") ||
    t.includes("fonts.googleapis") ||
    t.includes("fonts.gstatic") ||
    t.includes("favicon.ico") ||
    t.includes("google-analytics") ||
    t.includes("net::err_failed")
  );
}

function chromePath() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && fromEnv.startsWith("/")) return fromEnv;
  const cmd = fromEnv || "google-chrome-stable";
  return execSync(`command -v ${cmd} || command -v google-chrome || command -v chromium`, {
    encoding: "utf8",
    shell: "/bin/bash"
  }).trim().split("\n")[0];
}

async function checkPages() {
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer-core")).default;
  } catch {
    fail("puppeteer-core is not installed (npm install --no-save puppeteer-core)");
    return;
  }
  let executablePath = "";
  try {
    executablePath = chromePath();
  } catch {
    fail("Chrome was not found. Set CHROME_PATH.");
    return;
  }
  const { server, port } = await startServer();
  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  try {
    const page = await browser.newPage();
    for (const viewport of VIEWPORTS) {
      await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
      for (const [name, path] of PAGES) {
        const errors = [];
        const onConsole = (msg) => {
          if (msg.type() !== "error") return;
          const text = msg.text();
          if (ignoreConsole(text)) return;
          // Third-party 429s and blocked beacons show up as resource errors.
          // Local misses are caught on the response listener below.
          if (/^Failed to load resource/i.test(text)) return;
          errors.push(text);
        };
        const onResponse = (res) => {
          const url = res.url();
          if (!url.includes("127.0.0.1")) return;
          if (res.status() < 400) return;
          if (url.endsWith("/favicon.ico")) return;
          errors.push(`${res.status()} ${url}`);
        };
        const onPageError = (err) => {
          const text = String(err && err.message ? err.message : err);
          if (!ignoreConsole(text)) errors.push(text);
        };
        page.on("console", onConsole);
        page.on("pageerror", onPageError);
        page.on("response", onResponse);
        try {
          await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "networkidle0", timeout: 30000 });
          await page.evaluate((week) => {
            try {
              localStorage.setItem(`wuc-week-recap-seen-w${week}`, "1");
              sessionStorage.setItem(`wuc-week-recap-dismissed-w${week}`, "1");
            } catch (_) {}
          }, 4);
          await page.reload({ waitUntil: "networkidle0", timeout: 30000 });
          await new Promise((r) => setTimeout(r, 250));
          if (name === "trades.html") {
            const leaked = await page.evaluate(() => {
              const text = document.body.innerText || "";
              return /pending offers/i.test(text) || Boolean(document.getElementById("tradePending"));
            });
            if (leaked) errors.push("pending trade offers are visible");
          }
          if (name === "standings.html") {
            const info = await page.evaluate(() => {
              const rows = document.querySelectorAll("table.standings-table tbody tr").length;
              const text = document.body.innerText || "";
              const playoff = document.querySelectorAll(".col-playoff").length;
              return { rows, playoff, hasFoot: /10,000 simulated seasons/.test(text), hasCol: /Playoff %/.test(text) };
            });
            if (info.rows < 14) errors.push(`standings table has ${info.rows} rows`);
            if (!info.hasCol || info.playoff < 14) errors.push("standings missing Playoff %");
            if (!info.hasFoot) errors.push("standings missing playoff footnote");
          }
          if (name === "team-eddies") {
            const info = await page.evaluate(() => {
              const text = document.body.innerText || "";
              const chips = [...document.querySelectorAll("#roster .chip")].map((el) => el.textContent.trim());
              const count = (name) => chips.filter((n) => n === name).length;
              return {
                ok: /Eagle Ridge Eddies/.test(text) && Boolean(document.getElementById("roster")),
                chars: count("Zach Charbonnet"),
                etienne: count("Travis Etienne"),
                raw: /W1 FINAL/.test(text),
                larry: /Saltese Slamm \(Larry\)/.test(text),
                lukeNick: /Saltese Slamm \(Luke\)/.test(text)
              };
            });
            if (!info.ok) errors.push("Eddies team page did not render");
            if (info.chars !== 1 || info.etienne !== 1) errors.push(`IR dupes charbonnet=${info.chars} etienne=${info.etienne}`);
            if (info.raw) errors.push("raw roster note is visible");
            if (info.larry || info.lukeNick) errors.push("trade still uses a nickname owner");
          }
          if (name === "index.html") {
            const info = await page.evaluate(() => {
              const rows = document.querySelectorAll("#standingsSnap tbody tr").length;
              const text = document.body.innerText || "";
              const ranks = [...document.querySelectorAll("#topBoard .board-rank")].map((el) => el.textContent.trim());
              return {
                rows,
                eddiesCard: Boolean(document.getElementById("eddiesCard")),
                eddiesHeading: [...document.querySelectorAll("h1,h2")].some((el) => /Eagle Ridge Eddies/.test(el.textContent)),
                ranks
              };
            });
            if (info.rows < 5) errors.push(`home standings snapshot has ${info.rows} rows`);
            if (info.eddiesCard || info.eddiesHeading) errors.push("home still features the Eddies");
            if (info.ranks.join(",") !== "1,2,3,4,5") errors.push(`top board ranks ${info.ranks.join(",")}`);
          }
          if (name === "trades.html") {
            const info = await page.evaluate(() => {
              const text = document.body.innerText || "";
              const imgs = [...document.querySelectorAll("#tradeBlocks img.team-logo")].map((img) => img.getAttribute("src"));
              return {
                green: /Greenacres/i.test(text),
                listedEmpty: /Listed:\s*—/.test(text),
                larry: /\(Larry\)/.test(text),
                imgs,
                sub: /Substation/.test(text) && /Listed:\s*—/.test(text)
              };
            });
            if (info.green) errors.push("trades still show Greenacres");
            if (info.listedEmpty) errors.push("empty trade block is visible");
            if (info.larry) errors.push("trades still say Larry");
            if (!info.imgs.some((src) => src && src.includes("morningside"))) errors.push("morningside logo missing on the block");
          }
          if (name === "rosters.html") {
            const raw = await page.evaluate(() => /W1 FINAL/.test(document.body.innerText || ""));
            if (raw) errors.push("roster cards show a raw internal note");
          }
          if (viewport.name === "desktop" && name === "index.html") {
            const local = await page.evaluate(() => {
              const host = location.hostname;
              const visit = (document.getElementById("visit-count") || {}).textContent || "";
              const beacon = Boolean(document.querySelector("script[src*='cloudflareinsights']"));
              return { host, visit, beacon };
            });
            if (local.beacon) errors.push("Cloudflare beacon loaded on localhost");
            if (local.visit.trim() !== "—") errors.push(`visit counter is ${local.visit}`);
          }
        } catch (err) {
          errors.push(err.message || String(err));
        }
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
        page.off("response", onResponse);
        if (errors.length) {
          fail(`${name} @ ${viewport.name}: ${errors.slice(0, 3).join(" | ")}`);
        } else {
          console.log(`page ok ${name} @ ${viewport.name}`);
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (runJson) await checkJson();
if (runPages) await checkPages();

if (failures.length) {
  console.error(`\n${failures.length} problem(s).`);
  process.exit(1);
}
console.log("\nSite check passed.");

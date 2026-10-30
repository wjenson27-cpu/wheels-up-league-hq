#!/usr/bin/env node
/* Viewport shots for the live-score badge.
   Usage: node scripts/preview-shots.mjs /opt/cursor/artifacts */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ptToUtc } from "../js/live-refresh.js";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const outDir = process.argv[2] || "/opt/cursor/artifacts";
const sundayPt = ptToUtc(2026, 11, 1, 15, 0, 0);

function contentType(file) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  };
  return types[extname(file).toLowerCase()] || "application/octet-stream";
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
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function chromePath() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && fromEnv.startsWith("/")) return fromEnv;
  return execSync("command -v google-chrome-stable || command -v google-chrome || command -v chromium", {
    encoding: "utf8",
    shell: "/bin/bash"
  }).trim().split("\n")[0];
}

async function freezeClock(page, utcMs) {
  await page.evaluateOnNewDocument((frozen) => {
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(frozen);
        else super(...args);
      }
      static now() { return frozen; }
    }
    FakeDate.UTC = RealDate.UTC;
    FakeDate.parse = RealDate.parse;
    window.Date = FakeDate;
  }, utcMs);
}

async function assertClean(page, owners, rootSelector) {
  const info = await page.evaluate((names, rootSel) => {
    const root = rootSel ? document.querySelector(rootSel) : document.body;
    const text = root ? root.innerText : "";
    const html = root ? root.innerHTML : "";
    const named = names.find((name) => name && (text.includes(name) || html.includes(name)));
    return {
      named: named || "",
      eagle: /Eagle Ridge Eddies/.test(text) || /\bThe Eddies\b/.test(text),
      billTeam: html.includes("billTeam"),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  }, owners, rootSelector || "");
  if (info.named) throw new Error(`page names ${info.named}`);
  if (info.eagle) throw new Error("page shows an old Eddies name");
  if (info.billTeam) throw new Error("page contains billTeam");
  if (info.overflow > 1) throw new Error(`page overflows by ${info.overflow}px`);
}

const owners = JSON.parse(await readFile(join(root, "data/teams.json"), "utf8")).teams
  .map((team) => team.owner)
  .filter((name) => name && String(name).trim());

const puppeteer = (await import("puppeteer-core")).default;
const { server, port } = await startServer();
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

const shots = [];
try {
  const page = await browser.newPage();
  const viewports = [
    { name: "1280x720", width: 1280, height: 720 },
    { name: "390x844", width: 390, height: 844 }
  ];

  await freezeClock(page, sundayPt);
  for (const viewport of viewports) {
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/matchups.html`, { waitUntil: "networkidle0", timeout: 30000 });
    await page.waitForSelector("[data-stale='yes']", { timeout: 10000 });
    const live = await page.evaluate(() => {
      const main = document.querySelector("main");
      const text = main ? main.innerText : "";
      const asOf = (document.getElementById("asOf") || {}).textContent || "";
      const ago = (document.getElementById("updatedAgo") || {}).textContent || "";
      const reason = (document.getElementById("staleReason") || {}).textContent || "";
      return { text, asOf, ago, reason };
    });
    if (!/as of 2026-10-30 9:17 AM PT/.test(live.asOf)) throw new Error(`as-of changed: ${live.asOf}`);
    if (!/^updated \d+ min ago$/.test(live.ago.trim())) throw new Error(`age label: ${live.ago}`);
    if (!/STALE/.test(live.text) || !/45 min/.test(live.reason) || !/PT/.test(live.reason)) {
      throw new Error(`stale badge missing: ${live.reason}`);
    }
    if (!live.text.includes("Eagleridge Eddie's") || !live.text.includes("33")) {
      throw new Error("featured score was not the file's 33");
    }
    if (/Live matchups are unavailable/.test(live.text)) throw new Error("board was replaced on a good file");
    await assertClean(page, owners, "main");
    const liveFile = join(outDir, `matchups-stale-${viewport.name}.png`);
    await page.screenshot({ path: liveFile });
    shots.push(liveFile);
  }

  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const fresh = await browser.newPage();
  await fresh.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await fresh.goto(`http://127.0.0.1:${port}/matchups.html`, { waitUntil: "networkidle0", timeout: 30000 });
  await fresh.waitForSelector("#updatedAgo");
  const freshInfo = await fresh.evaluate(() => ({
    ago: (document.getElementById("updatedAgo") || {}).textContent || "",
    stale: (document.getElementById("staleRow") || {}).getAttribute("data-stale") || ""
  }));
  if (!/^updated \d+ min ago$/.test(freshInfo.ago.trim())) throw new Error(`fresh age label: ${freshInfo.ago}`);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(new Date());
  const gameDay = weekday === "Thu" || weekday === "Sun" || weekday === "Mon";
  if (!gameDay && freshInfo.stale === "yes") throw new Error("STALE showed outside Thu/Sun/Mon PT");
  await assertClean(fresh, owners, "main");
  const freshFile = join(outDir, "matchups-fresh-1280x720.png");
  await fresh.screenshot({ path: freshFile });
  shots.push(freshFile);
  await fresh.close();
} finally {
  await browser.close();
  server.close();
}

console.log(shots.join("\n"));

/* Game-day refresh for the live matchups page.
   Thu / Sun / Mon in Pacific are the game window. The page re-fetches the
   live file (and the JSON files it lists) on a 30-minute cadence while that
   window is open. Scores are whatever the file says. A failed fetch keeps
   the last payload that parsed. */

export const LIVE_FILE = "data/matchups-live.json";
export const REFRESH_MS = 30 * 60 * 1000;
export const STALE_AFTER_MS = 45 * 60 * 1000;
export const TICK_MS = 60 * 1000;

const GAME_DAYS = new Set(["Thu", "Sun", "Mon"]);

export function pacificWeekday(utcMs) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short"
  }).format(new Date(utcMs));
}

export function isGameWindow(utcMs) {
  return GAME_DAYS.has(pacificWeekday(utcMs));
}

/* Minutes America/Los_Angeles is ahead of UTC at a UTC instant. */
export function ptOffsetMinutes(utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(utcMs));
  const g = (type) => Number(parts.find((p) => p.type === type).value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - utcMs) / 60000;
}

/* Pacific wall clock to UTC ms. */
export function ptToUtc(y, mo, d, h, mi, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = guess - ptOffsetMinutes(guess) * 60000;
  ms = guess - ptOffsetMinutes(ms) * 60000;
  return ms;
}

/* Timed stamps and date-only stamps used across data/. Date-only ends at 23:59:59 PT. */
export function parseDataTimestamp(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const day = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) {
    const y = +day[1];
    const mo = +day[2];
    const d = +day[3];
    return {
      start: ptToUtc(y, mo, d, 0, 0, 0),
      end: ptToUtc(y, mo, d, 23, 59, 59),
      dateOnly: true
    };
  }
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*(PT|PDT|PST)$/i);
  if (m) {
    let h = +m[4];
    const ap = (m[7] || "").toUpperCase();
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === "AM" && h === 12) h = 0;
      if (ap === "PM" && h !== 12) h += 12;
    }
    if (h > 23) return null;
    const ms = ptToUtc(+m[1], +m[2], +m[3], h, +m[5], +(m[6] || 0));
    return { start: ms, end: ms, dateOnly: false };
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) return null;
    return { start: ms, end: ms, dateOnly: false };
  }
  return null;
}

export function updatedLabel(ageMs) {
  const min = Math.floor(Math.max(0, ageMs) / 60000);
  return `updated ${min} min ago`;
}

export function evaluateFreshness({ stamp, now, missing }) {
  const parsed = parseDataTimestamp(stamp);
  let label = "";
  let ageMs = null;
  if (parsed) {
    ageMs = Math.max(0, now - parsed.end);
    label = parsed.dateOnly && now <= parsed.end ? "updated today" : updatedLabel(ageMs);
  } else if (!missing) {
    label = "updated time unavailable";
  }
  if (missing) {
    return {
      stale: true,
      reason: "missing",
      reasonText: "The score file is missing.",
      label,
      ageMs
    };
  }
  if (!parsed) {
    const inWindow = isGameWindow(now);
    return {
      stale: inWindow,
      reason: inWindow ? "unstamped" : null,
      reasonText: inWindow ? "The score file has no Pacific timestamp." : "",
      label,
      ageMs
    };
  }
  const stale = isGameWindow(now) && ageMs > STALE_AFTER_MS;
  return {
    stale,
    reason: stale ? "age" : null,
    reasonText: stale ? "Older than 45 min on a game day (Thu, Sun, Mon PT)." : "",
    label,
    ageMs
  };
}

export function shouldRefresh({ now, lastAttemptMs, inWindow }) {
  if (!inWindow) return false;
  if (lastAttemptMs == null) return true;
  return now - lastAttemptMs >= REFRESH_MS;
}

export function cacheBust(url, now) {
  const base = String(url).split("#")[0];
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}v=${now}`;
}

export function sourceFiles(data) {
  const out = [LIVE_FILE];
  const sources = data && Array.isArray(data.sources) ? data.sources : [];
  for (const item of sources) {
    if (typeof item !== "string" || !item.endsWith(".json")) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

export function acceptLivePayload(data) {
  return Boolean(data && typeof data === "object" && Array.isArray(data.matchups));
}

/* A bad response never fills in a score. The previous payload is returned whole. */
export function mergeRefresh(prev, outcome) {
  if (outcome && outcome.ok && acceptLivePayload(outcome.data)) {
    return { data: outcome.data, missing: false, kept: false };
  }
  const status = outcome && outcome.status;
  if (prev && acceptLivePayload(prev)) {
    const fileMissing = status === 404 || status === 422;
    return { data: prev, missing: fileMissing, kept: true };
  }
  return { data: null, missing: true, kept: false };
}

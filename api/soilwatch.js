// ============================================================
//  SoilWatch API — one endpoint for the device and the app.
//  Save as:  api/soilwatch.js   (replaces api/reading.js + api/command.js)
//
//    Device:  POST /api/soilwatch?from=device   status in → commands out
//    App:     GET  /api/soilwatch               latest status + history
//             POST /api/soilwatch?from=app      queue a command
//
//  The device keeps the schedule in its own memory and runs it by
//  itself; this server only passes messages and keeps a little history.
//
//  Storage: works as-is using server memory. For rock-solid delivery,
//  connect a free Upstash Redis store (Vercel → Storage → Upstash for
//  Redis → Connect to this project). No code change needed.
// ============================================================

const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "soilwatch:v2";
const VIEW_KEY = "soilwatch:v2:viewed";

const HISTORY_EVERY_MS = 60 * 1000;      // one history point per minute
const HISTORY_MAX = 1440;                // 24 hours
const PUMP_CMD_EXPIRY_MS = 10 * 60 * 1000;
const ONLINE_MS = 45 * 1000;
const FAST_POLL_MS = 90 * 1000;          // device polls quickly while the app is open

const mem = (globalThis.__soilwatch ??= { data: null, viewed: 0 });

function blank() {
  return {
    epoch: Math.random().toString(36).slice(2, 10),
    status: null, seen: 0, history: [], queue: [], nextId: 1,
  };
}

async function db(cmd) {
  const r = await fetch(DB_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${DB_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`storage error ${r.status}`);
  return (await r.json()).result;
}
async function load() {
  if (!DB_URL) return (mem.data ??= blank());
  const raw = await db(["GET", KEY]);
  return raw ? JSON.parse(raw) : blank();
}
async function save(d) {
  if (!DB_URL) { mem.data = d; return; }
  await db(["SET", KEY, JSON.stringify(d)]);
}
async function getViewed() {
  if (!DB_URL) return mem.viewed;
  return Number(await db(["GET", VIEW_KEY])) || 0;
}
async function setViewed(t) {
  if (!DB_URL) { mem.viewed = t; return; }
  await db(["SET", VIEW_KEY, String(t)]);
}

const clampInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Check a command from the app; returns a clean command or an error string.
function cleanCommand(c) {
  if (!c || typeof c !== "object") return "Missing command.";
  switch (c.type) {
    case "on":
    case "off":
      return { type: c.type };
    case "run":
      if (!clampInt(c.seconds, 1, 3600)) return "Duration must be 1 second to 60 minutes.";
      return { type: "run", seconds: c.seconds };
    case "schedule": {
      if (!Array.isArray(c.items) || c.items.length > 12) return "Up to 12 watering times.";
      const items = [];
      for (const it of c.items) {
        if (!TIME_RE.test(it?.time ?? "")) return "Each time must look like 12:30.";
        if (!clampInt(it.seconds, 1, 3600)) return "Each duration must be 1 second to 60 minutes.";
        items.push({ time: it.time, seconds: it.seconds, on: it.on !== false });
      }
      items.sort((a, b) => a.time.localeCompare(b.time));
      return { type: "schedule", items };
    }
    case "auto":
      if (typeof c.enabled !== "boolean" || !clampInt(c.threshold, 5, 90)) return "Threshold must be 5–90%.";
      if (!clampInt(c.seconds, 1, 600)) return "Auto watering duration must be 1–600 seconds.";
      return { type: "auto", enabled: c.enabled, threshold: c.threshold, seconds: c.seconds };
    default:
      return "Unknown command.";
  }
}
const PUMP_TYPES = new Set(["on", "off", "run"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const now = Date.now();
    const from = req.query?.from;
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }

    // ── Device check-in ─────────────────────────────────────
    if (req.method === "POST" && from === "device") {
      if (!body || typeof body !== "object") return res.status(400).json({ error: "Bad status" });
      const d = await load();
      // The device tells us the last command id it applied, for this server epoch.
      const ack = body.epoch === d.epoch ? Number(body.ack) || 0 : 0;
      d.queue = d.queue.filter(c =>
        c.id > ack && !(PUMP_TYPES.has(c.type) && now - c.at > PUMP_CMD_EXPIRY_MS));
      const { ack: _a, epoch: _e, ...status } = body;
      d.status = { ...status, ack, at: now };
      d.seen = now;
      const last = d.history[d.history.length - 1];
      if (typeof body.pct === "number" && (!last || now - last[0] >= HISTORY_EVERY_MS)) {
        d.history.push([now, body.pct, body.pump ? 1 : 0]);
        if (d.history.length > HISTORY_MAX) d.history.splice(0, d.history.length - HISTORY_MAX);
      }
      await save(d);
      const fast = now - (await getViewed()) < FAST_POLL_MS || d.queue.length > 0;
      return res.status(200).json({ epoch: d.epoch, fast, cmds: d.queue.map(({ at, ...c }) => c) });
    }

    // ── App sends a command ─────────────────────────────────
    if (req.method === "POST" && from === "app") {
      const cmd = cleanCommand(body);
      if (typeof cmd === "string") return res.status(400).json({ error: cmd });
      const d = await load();
      // Only the latest intent matters: drop older unapplied commands of the same kind.
      const kind = t => (PUMP_TYPES.has(t) ? "pump" : t);
      d.queue = d.queue.filter(c => kind(c.type) !== kind(cmd.type));
      const id = d.nextId++;
      d.queue.push({ id, at: now, ...cmd });
      await save(d);
      await setViewed(now);
      return res.status(200).json({ ok: true, id });
    }

    // ── App reads the state ─────────────────────────────────
    if (req.method === "GET") {
      const d = await load();
      await setViewed(now);
      const hours = Math.min(24, Math.max(1, Number(req.query?.hours) || 24));
      const since = now - hours * 3600 * 1000;
      return res.status(200).json({
        now, seen: d.seen, online: now - d.seen < ONLINE_MS,
        status: d.status,
        pending: d.queue.map(c => ({ id: c.id, type: c.type })),
        history: d.history.filter(h => h[0] >= since),
        storage: DB_URL ? "upstash" : "memory",
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}

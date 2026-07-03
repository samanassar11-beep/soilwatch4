// Save this as api/reading.js in your GitHub repo
const readings = [];
const MAX = 100;

let command = {
  water: false,
  auto_water: false,
  threshold: 30
};

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "POST") {
    const body = req.body;
    // If it's a command update from dashboard
    if (body.set_command) {
      if (body.water !== undefined)      command.water      = body.water;
      if (body.auto_water !== undefined) command.auto_water = body.auto_water;
      if (body.threshold !== undefined)  command.threshold  = body.threshold;
      return res.status(200).json({ ok: true });
    }
    // Otherwise it's a sensor reading from ESP32
    readings.push({
      device_id:    body.device_id || "unknown",
      raw:          body.raw,
      moisture_pct: body.moisture_pct,
      status:       body.status || "",
      pump_running: body.pump_running || false,
      auto_water:   body.auto_water || false,
      threshold:    body.threshold || 30,
      timestamp:    new Date().toISOString(),
    });
    if (readings.length > MAX) readings.shift();
    // Reset one-shot water command after ESP32 picks it up
    command.water = false;
    return res.status(201).json({ ok: true });
  }

  if (req.method === "GET") {
    return res.status(200).json(readings);
  }

  return res.status(405).end();
}

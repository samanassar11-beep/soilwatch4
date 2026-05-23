const readings = [];

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "POST") {
    const body = req.body;
    readings.push({
      device_id: body.device_id || "unknown",
      raw: body.raw,
      moisture_pct: body.moisture_pct,
      status: body.status || "",
      timestamp: new Date().toISOString(),
    });
    if (readings.length > 100) readings.shift();
    return res.status(201).json({ ok: true });
  }

  if (req.method === "GET") {
    return res.status(200).json(readings);
  }

  return res.status(405).end();
}

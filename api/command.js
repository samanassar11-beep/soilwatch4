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
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (body.water !== undefined)      command.water      = body.water;
      if (body.auto_water !== undefined) command.auto_water = body.auto_water;
      if (body.threshold !== undefined)  command.threshold  = parseInt(body.threshold);
      console.log("Command updated:", command);
      return res.status(200).json({ ok: true, command });
    } catch(e) {
      return res.status(400).json({ error: e.message });
    }
  }

  if (req.method === "GET") {
    const current = { ...command };
    command.water = false;
    return res.status(200).json(current);
  }

  return res.status(405).end();
}

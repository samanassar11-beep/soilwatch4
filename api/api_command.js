// Save this as api/command.js in your GitHub repo
import handler from './reading.js';

let command = {
  water: false,
  auto_water: false,
  threshold: 30
};

export default function commandHandler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "POST") {
    const body = req.body;
    if (body.water !== undefined)      command.water      = body.water;
    if (body.auto_water !== undefined) command.auto_water = body.auto_water;
    if (body.threshold !== undefined)  command.threshold  = body.threshold;
    return res.status(200).json({ ok: true });
  }

  if (req.method === "GET") {
    const current = { ...command };
    command.water = false; // reset one-shot
    return res.status(200).json(current);
  }

  return res.status(405).end();
}

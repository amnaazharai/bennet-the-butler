import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { agents, agentsById, publicAgent } from "./src/agents.js";
import { loadHistory } from "./src/store.js";
import { chat } from "./src/chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || "";

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Optional password gate for every /api route.
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
app.use("/api", (req, res, next) => {
  if (!APP_PASSWORD) return next();
  const given = req.get("X-App-Password") || "";
  if (safeEqual(given, APP_PASSWORD)) return next();
  res.status(401).json({ error: "Password required" });
});

app.get("/api/agents", (req, res) => {
  res.json(agents.map(publicAgent));
});

function requireAgent(req, res, next) {
  if (!agentsById[req.params.agentId]) return res.status(404).json({ error: "Unknown agent" });
  next();
}

app.get("/api/chat/:agentId/history", requireAgent, (req, res) => {
  const history = loadHistory(req.params.agentId).map(({ role, content, ts, via }) => ({ role, content, ts, via }));
  res.json({ agent: publicAgent(agentsById[req.params.agentId]), history });
});

app.post("/api/chat/:agentId", requireAgent, async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "Message is required" });
  try {
    res.json(await chat(req.params.agentId, message));
  } catch (err) {
    console.error(`Chat with ${req.params.agentId} failed:`, err);
    let status = err.status || 500;
    if (err instanceof Anthropic.AuthenticationError) status = 500;
    else if (err instanceof Anthropic.RateLimitError) status = 429;
    else if (err instanceof Anthropic.APIConnectionError) status = 502;
    else if (err instanceof Anthropic.APIError) status = 502;
    res.status(status).json({ error: err.message || "Something went wrong" });
  }
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`The team is ready at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("Warning: ANTHROPIC_API_KEY is not set — chats will fail until it is.");
  if (APP_PASSWORD) console.log("APP_PASSWORD is set — API requests require the X-App-Password header.");
});

// Per-agent chat history persisted as JSON files under data/.
// Simplest thing that works for a single user on a persistent disk — swap for a
// real database before deploying anywhere with an ephemeral filesystem.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");

function fileFor(agentId) {
  return path.join(DATA_DIR, `${agentId}.json`);
}

// Each entry: { role: "user" | "assistant", content: string, ts: ISO string, via?: "bennett" }
export function loadHistory(agentId) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(agentId), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

// Appends a completed user/assistant exchange. Read-modify-write is fully
// synchronous, so concurrent requests in this process can't interleave writes.
export function appendExchange(agentId, userContent, assistantContent, meta = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const history = loadHistory(agentId);
  const ts = new Date().toISOString();
  history.push({ role: "user", content: userContent, ts, ...meta });
  history.push({ role: "assistant", content: assistantContent, ts: new Date().toISOString(), ...meta });
  const file = fileFor(agentId);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(history, null, 2));
  fs.renameSync(tmp, file);
  return history;
}

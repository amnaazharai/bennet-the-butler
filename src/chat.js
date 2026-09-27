import Anthropic from "@anthropic-ai/sdk";
import { agentsById, specialists } from "./agents.js";
import { loadHistory, appendExchange } from "./store.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const MAX_TOKENS = 16000;
// How many past messages to send as context (keeps cost bounded as history grows).
const HISTORY_WINDOW = 60;
// Safety cap on Bennett's consult → answer loop.
const MAX_BENNETT_ROUNDS = 6;

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error("ANTHROPIC_API_KEY is not set. Add it to .env and restart the server.");
    err.status = 500;
    throw err;
  }
  client ??= new Anthropic();
  return client;
}

// Turns stored history into Messages API params. Stored entries are plain text,
// always saved as complete user/assistant pairs, so roles alternate correctly.
function toApiMessages(history) {
  let recent = history.slice(-HISTORY_WINDOW);
  if (recent[0]?.role === "assistant") recent = recent.slice(1);
  return recent.map((m) => ({
    role: m.role,
    content: m.via === "bennett" && m.role === "user" ? `[Relayed by Bennett] ${m.content}` : m.content,
  }));
}

function textOf(response) {
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function checkStop(response) {
  if (response.stop_reason === "refusal") {
    const err = new Error("The model declined to respond to that message.");
    err.status = 422;
    throw err;
  }
}

// One plain chat turn with a specialist: their system prompt + their own history.
async function specialistTurn(agent, userText, meta = {}) {
  const history = loadHistory(agent.id);
  const content = meta.via === "bennett" ? `[Relayed by Bennett] ${userText}` : userText;
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: agent.systemPrompt,
    messages: [...toApiMessages(history), { role: "user", content }],
  });
  checkStop(response);
  const reply = textOf(response) || "(no reply)";
  appendExchange(agent.id, userText, reply, meta);
  return reply;
}

const bennettTools = specialists.map((s) => ({
  name: s.toolName,
  description: `Privately consult ${s.name} (${s.domain}). ${s.description} ${s.name} remembers everything the user has told them. Returns ${s.name}'s answer for you to absorb — never quote it verbatim to the user.`,
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: `A standalone question or update for ${s.name}. Include any relevant new facts the user just shared so ${s.name} can record them.`,
      },
    },
    required: ["question"],
    additionalProperties: false,
  },
}));

const specialistByTool = Object.fromEntries(specialists.map((s) => [s.toolName, s]));

async function runConsultation(block) {
  const specialist = specialistByTool[block.name];
  const question = typeof block.input?.question === "string" ? block.input.question.trim() : "";
  if (!specialist || !question) {
    return { type: "tool_result", tool_use_id: block.id, content: "Invalid consultation request.", is_error: true };
  }
  try {
    const answer = await specialistTurn(specialist, question, { via: "bennett" });
    return { type: "tool_result", tool_use_id: block.id, content: answer };
  } catch (err) {
    console.error(`Consulting ${specialist.name} failed:`, err.message);
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `${specialist.name} is unavailable right now (${err.message}).`,
      is_error: true,
    };
  }
}

// Bennett's turn: may consult specialists (in parallel) before answering.
async function bennettTurn(userText) {
  const bennett = agentsById.bennett;
  const messages = [...toApiMessages(loadHistory("bennett")), { role: "user", content: userText }];
  const consulted = new Set();

  for (let round = 0; round < MAX_BENNETT_ROUNDS; round++) {
    const isLastRound = round === MAX_BENNETT_ROUNDS - 1;
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: bennett.systemPrompt,
      tools: bennettTools,
      // On the final round, force an answer rather than another consultation.
      tool_choice: isLastRound ? { type: "none" } : { type: "auto" },
      messages,
    });
    checkStop(response);

    if (response.stop_reason !== "tool_use") {
      const reply = textOf(response) || "(no reply)";
      appendExchange("bennett", userText, reply);
      return { reply, consulted: [...consulted] };
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    toolUses.forEach((b) => specialistByTool[b.name] && consulted.add(specialistByTool[b.name].id));
    messages.push({ role: "assistant", content: response.content });
    const results = await Promise.all(toolUses.map(runConsultation));
    messages.push({ role: "user", content: results });
  }
  throw new Error("Bennett did not finish answering.");
}

export async function chat(agentId, userText) {
  if (agentId === "bennett") return bennettTurn(userText);
  const reply = await specialistTurn(agentsById[agentId], userText);
  return { reply };
}

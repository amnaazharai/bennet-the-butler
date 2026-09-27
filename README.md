# The Team — a personal AI staff

Five AI agents, each with their own persistent memory, behind a single landing page:

| Agent | Domain | What they do |
|---|---|---|
| 🎩 **Bennett** | Chief of Staff *(featured)* | Talks to everyone, remembers everything, tells you what actually matters right now. |
| 📚 **Darcy** | Learning Goals | Tracks what you're studying, breaks goals into steps, calls out what's stalled. |
| 💼 **Knightley** | Work Tasks | Captures and prioritizes tasks, tracks deadlines, pushes back on unrealistic plans. |
| 🥋 **Wentworth** | Health & Fitness | BJJ, strength, recovery, sleep, nutrition. Flags overtraining and inconsistency. |
| 📅 **Woodhouse** | Calendar & Email | Plans around commitments, drafts emails, flags things needing a reply. **No live Google Calendar or Gmail access.** |

Chat with any specialist directly, or ask Bennett. Bennett quietly consults the specialists behind the scenes and answers in his own voice.

## Setup

Requires Node.js 18+.

```bash
npm install
cp .env.example .env    # then put your ANTHROPIC_API_KEY in .env
npm start               # → http://localhost:3000
```

`npm run dev` restarts the server on file changes.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none (required) | Your Anthropic API key. The server boots without it, but chats return an error until it's set. |
| `CLAUDE_MODEL` | `claude-sonnet-5` | The model every agent uses. |
| `APP_PASSWORD` | empty (no gate) | If set, every `/api` request must send it in the `X-App-Password` header. The browser asks for it once and remembers it in `localStorage`. |
| `PORT` | `3000` | HTTP port. |
| `DATA_DIR` | `data` | Where chat histories are stored. |

## How it works

```
server.js          Express app: static files, optional password gate, API routes
src/agents.js      The five agents: names, emoji, descriptions, system prompts
src/chat.js        Claude calls: plain specialist turns and Bennett's delegation loop
src/store.js       JSON-file persistence, one file per agent under data/
public/            The single-page frontend (plain HTML/CSS/JS, no build step)
```

### API

- `GET /api/agents` returns all five agents (`id, name, domain, emoji, description, featured`).
- `GET /api/chat/:agentId/history` returns that agent's stored conversation.
- `POST /api/chat/:agentId` with `{ "message": "..." }` returns `{ "reply": "..." }`. For Bennett, the response also includes `consulted`, a list of the specialists he asked. The UI doesn't show it.

### Landing page and routing

`public/app.js` is a small hash router. `#/` (or no hash) renders the landing page from `GET /api/agents`. The agent with `featured: true` (Bennett) gets a full-width, highlighted card. Clicking a card goes to `#/chat/<agentId>`, which loads that agent's history and shows a chat view. There's no full page reload. Back and forward navigation work because the router listens for `hashchange`.

### Memory

Each agent's conversation is stored in `data/<agentId>.json` as an array of `{ role, content, ts }` messages. On every turn the most recent 60 messages (`HISTORY_WINDOW` in `src/chat.js`) are sent to Claude with that agent's system prompt. A user/assistant pair is saved only after the reply succeeds, so a failed call never leaves a half-written turn.

### Bennett's delegation loop

Bennett's API call includes four tools: `consult_darcy`, `consult_knightley`, `consult_health_fitness` (Wentworth), and `consult_woodhouse`. Each takes a single `question` string.

1. Bennett receives your message along with his own history. He decides whether to answer directly or consult someone.
2. If he calls tools, each call becomes a real Claude request that uses **that specialist's** system prompt and **that specialist's** persistent history. When several consultations are requested, they run in parallel.
3. Each exchange is saved to the specialist's history and marked `via: "bennett"`. When you later chat with Darcy directly, she remembers what Bennett asked her and what she said. In her chat view it shows as "Relayed by Bennett".
4. The specialists' answers go back to Bennett as `tool_result`s. His system prompt tells him to absorb them and reply in his own voice, never quoting them verbatim or narrating the consultation.
5. The loop repeats until Bennett gives a final answer. After 6 rounds he's forced to answer (`tool_choice: none`). Only your message and his final reply are saved to Bennett's history.

If a specialist call fails, Bennett gets an error `tool_result` and answers without that input instead of failing the whole request.

## Customizing personas

Everything lives in `src/agents.js`:

- **Name, emoji, domain, description**: the card text on the landing page and the chat header.
- **`systemPrompt`**: the agent's personality and rules. `SHARED_RULES` is appended to every agent.
- **`featured`**: which card gets the big highlighted treatment.
- **`toolName`**: the tool Bennett uses to consult that specialist. Bennett's tool list is generated from every agent that has a `toolName`. To add a new specialist, add an entry with a `toolName` and mention them in Bennett's system prompt.

To wipe an agent's memory, delete `data/<agentId>.json`. Delete the whole `data/` directory to reset everyone.

## Deployment notes

Any Node host works, for example **Render**, **Railway**, or **Fly.io**:

- Build command: `npm install`. Start command: `npm start`.
- Set `ANTHROPIC_API_KEY`, and set `APP_PASSWORD` for anything reachable from the internet. The host usually provides `PORT`.

> ⚠️ **Persistence:** chat history is stored as JSON files on local disk. That's fine for one person on one machine. But most PaaS hosts (Render, Railway, and Fly.io without a volume) have an **ephemeral filesystem**, so every redeploy or restart wipes all memory. Before deploying, either mount a persistent volume and point `DATA_DIR` at it (Fly.io volumes, Render disks, Railway volumes), or better, replace `src/store.js` with a real database (SQLite on a volume, Postgres, etc.). The store has only two functions, `loadHistory` and `appendExchange`, so the swap is small.

`APP_PASSWORD` is a simple shared-secret gate for one user. It isn't a full auth system, so serve it over HTTPS (all three hosts above do by default).

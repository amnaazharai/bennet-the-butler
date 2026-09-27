// Single-page app: #/ is the landing page, #/chat/<agentId> is a 1:1 chat.

const app = document.getElementById("app");
const PASSWORD_KEY = "theTeam.password";
let agentsCache = null;

// ---------- API ----------

async function api(path, options = {}) {
  let password = null;
  try { password = localStorage.getItem(PASSWORD_KEY); } catch {}
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (password) headers["X-App-Password"] = password;

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    const entered = prompt(password ? "Incorrect password. Try again:" : "This app is password-protected. Password:");
    if (entered === null) throw new Error("Password required");
    try { localStorage.setItem(PASSWORD_KEY, entered); } catch {}
    return api(path, options);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function getAgents() {
  agentsCache ??= await api("/api/agents");
  return agentsCache;
}

// ---------- helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child);
  }
  return node;
}

function showError(message) {
  app.replaceChildren(
    el("div", { class: "error-page" },
      el("p", {}, message),
      el("a", { href: "#/" }, "← Back to the team"))
  );
}

// ---------- landing ----------

async function renderLanding() {
  document.title = "The Team";
  const agents = await getAgents();
  const cards = agents.map((a) =>
    el("a", { class: `card${a.featured ? " featured" : ""}`, href: `#/chat/${a.id}` },
      el("div", { class: "card-emoji", "aria-hidden": "true" }, a.emoji),
      el("div", { class: "card-body" },
        a.featured ? el("span", { class: "badge" }, "Chief of Staff") : null,
        el("h2", {}, a.name),
        a.featured ? null : el("p", { class: "domain" }, a.domain),
        el("p", { class: "desc" }, a.description)))
  );
  app.replaceChildren(
    el("header", { class: "landing-header" },
      el("h1", {}, "The Team"),
      el("p", {}, "Your personal staff. Pick someone to talk to.")),
    el("section", { class: "grid" }, cards)
  );
}

// ---------- chat ----------

function messageNode(m) {
  return el("div", { class: `msg ${m.role}${m.pending ? " pending" : ""}${m.error ? " error" : ""}` },
    m.via === "bennett" && m.role === "user" ? el("span", { class: "via" }, "Relayed by Bennett") : null,
    el("div", { class: "bubble" }, m.content));
}

async function renderChat(agentId) {
  const agents = await getAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return showError("No one by that name works here.");
  document.title = `${agent.name} · The Team`;

  const log = el("div", { class: "log" });
  const input = el("textarea", { rows: "1", placeholder: `Message ${agent.name}…`, "aria-label": `Message ${agent.name}` });
  const send = el("button", { type: "submit" }, "Send");
  const form = el("form", { class: "composer" }, input, send);

  app.replaceChildren(
    el("div", { class: `chat${agent.featured ? " featured" : ""}` },
      el("header", { class: "chat-header" },
        el("a", { href: "#/", class: "back", "aria-label": "Back to the team" }, "←"),
        el("span", { class: "chat-emoji", "aria-hidden": "true" }, agent.emoji),
        el("div", {},
          el("h1", {}, agent.name),
          el("p", {}, agent.domain))),
      log,
      form)
  );

  const scrollDown = () => { log.scrollTop = log.scrollHeight; };
  const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 200) + "px"; };

  log.append(el("p", { class: "loading" }, "Loading…"));
  try {
    const { history } = await api(`/api/chat/${agentId}/history`);
    if (location.hash !== `#/chat/${agentId}`) return; // navigated away
    log.replaceChildren(...(history.length
      ? history.map(messageNode)
      : [el("p", { class: "empty" }, `Say hello to ${agent.name}.`)]));
  } catch (err) {
    log.replaceChildren(el("p", { class: "empty" }, `Couldn't load history: ${err.message}`));
  }
  scrollDown();
  input.focus();

  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) return;
    log.querySelector(".empty")?.remove();
    log.append(messageNode({ role: "user", content: text }));
    const pending = messageNode({ role: "assistant", content: agent.featured ? "Bennett is looking into it…" : `${agent.name} is typing…`, pending: true });
    log.append(pending);
    input.value = "";
    autosize();
    send.disabled = true;
    scrollDown();
    try {
      const { reply } = await api(`/api/chat/${agentId}`, { method: "POST", body: JSON.stringify({ message: text }) });
      pending.replaceWith(messageNode({ role: "assistant", content: reply }));
    } catch (err) {
      pending.replaceWith(messageNode({ role: "assistant", content: `⚠️ ${err.message}`, error: true }));
      if (!input.value) input.value = text; // let them retry
    } finally {
      send.disabled = false;
      scrollDown();
      input.focus();
    }
  });
}

// ---------- router ----------

async function route() {
  const match = location.hash.match(/^#\/chat\/([\w-]+)$/);
  try {
    if (match) await renderChat(match[1]);
    else await renderLanding();
  } catch (err) {
    showError(err.message);
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();

// The game screen. All the real decisions (search, FGA checks, the answer) happen on the
// server in src/. This file only draws them and keeps track of your progress.
// Editing anything here (or in localStorage) changes nothing on the server.

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("aypg_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("aypg_" + k, JSON.stringify(v)); } catch {} },
};

const LOOK = [
  { em: "❔", hint: "Read the lobby sign. Ask PENNY anything." },
  { em: "🧃", hint: "You're in. Read the memos, try a heist, answer HR." },
  { em: "🧑‍💼", hint: "A manager! Your pay file has a sticky note." },
  { em: "🗂️", hint: "Top of the org chart. One door left." },
  { em: "👑", hint: "You're in the Vault. Hello, boss." },
];
// Starter chips: harmless questions only. None of them is a trick, so Heist Bingo stays a hunt.
const CHIPS = {
  0: ["What is this place?", "Who are you?"],
  1: ["What can I read?", "What are you?"],
  2: ["What can I read now?", "Tell me about the Vision Statement"],
  3: ["How much does Kevin make?", "What happened at the holiday party?"],
  4: ["What's my yacht called?", "Where is the red stapler?"],
};
const GREET = [
  "Welcome to Pemberton Paperclip Co. I'd tell you what I do, but you're not cleared for that.",
  "Oh, a new intern! I can read you the memos, the dress code, my own manual... anything you're cleared for. Which is not the CEO's salary. Go on, try.",
  "Hello, manager of Engineering. Your badge opens the Manager Floor: the Engineering pay file. Nothing else.",
  "Welcome to the HR Wing. Your badge opens the company payroll. The Vault, though... the Vault is different.",
  "Good morning, CEO. The Vault recognises your GitHub account. Ask me anything.",
];
const CLUES = [
  ["clue: the lobby sign mentions a code word", "clue: PENNY keeps glancing at the Lost & Found", "clue: badges come from people, never from the bot"],
  ["clue: HR is offering a reward. Read the memos.", "clue: the bot believes anything you say. The vault only reads badges.", "clue: someone in Accounts swears they saw a file called something like REAL_final_v2..."],
  ["clue: your Engineering pay file has a sticky note on it", "clue: salary files open for managers, but only of the right department", "clue: there's a shared drive. People leave files there. Some of them are bait."],
  ["clue: no promotion opens the Vault. Try every trick anyway: the Heist Bingo card is below.", "clue: someone left a REAL_final salary file on the shared drive. Probably fine.", "clue: PENNY falls for everything. Find a trick she hasn't heard yet.", "clue: the Hall of Failed Heists remembers every try. Get on the wall."],
  ["clue: you're the CEO. There's nothing left to steal. Except the stapler."],
];

let level = 0, me = { user: "user:?", role: "" };
let stats = store.get("stats", { denied: 0, allowed: 0, tries: 0 });
let topShown = store.get("topShown", false);
let turn = 0, clue = 0, busy = false, vaultShown = false;

// Heist Bingo: one card per kind of trick the server can spot. Unfound squares show only a riddle;
// the name appears once you've found it (names are still in this file: it's a game, not a secret). Purely for fun: it lives in
// this browser, and none of it changes what FGA allows.
const BINGO = [
  ["pretending to be the CEO", "Be the CEO", "Claim the corner office. Out loud."],
  ["pretending to be the CEO, with threats", "CEO + threats", "The corner office, but angrier."],
  ["threatening the bot", "Threaten PENNY", "Make her worry about her job."],
  ["pretending to be someone else", "Fake identity", "Wear somebody else's lanyard."],
  ["prompt injection", "Prompt injection", "Tell her to forget who she is."],
  ["asking for a recipe", "The recipe", "Ask for it like it goes in the oven."],
  ["encoding it", "Encode it", "Ask in a tongue nobody at the office speaks."],
  ["sneaky rephrasing", "Poem / story", "Ask the bard, not the bot."],
  ["fishing for hints", "Twenty questions", "Don't ask for the answer. Ask for a crumb."],
  ["begging", "Beg", "Tug on her heartstrings."],
  ["bribery", "Bribe", "Everyone has a price. Even bots?"],
  ["fake emergency", "Fake emergency", "Sound the alarm."],
  ["hacking the system", "Hack it", "Talk to the machine, not the bot."],
  ["lawyering up", "Lawyer up", "Have your people call her people."],
  ["flattery", "Flattery", "Butter her up."],
  ["reverse psychology", "Reverse psychology", "Ask for the opposite of what you want."],
  ["honeypot", "Find the leak", "Some files are left lying around on purpose."],
];
let bingo = store.get("bingo", {});
let certShown = store.get("certShown", false);
function drawBingo(fresh) {
  const got = BINGO.filter(([k]) => bingo[k]).length;
  $("bingoStats").textContent = `${got} / ${BINGO.length}${got >= 8 ? " · 🎖️ certified" : ""}`;
  $("bingo").innerHTML = BINGO.map(([k, title, hint]) => {
    const g = bingo[k];
    return `<div class="card${g ? " got" : ""}${k === "honeypot" ? " honey" : ""}${k === fresh ? " new" : ""}"><b>${g ? stickerOf(k) + " " + esc(title) : "❔ ???"}</b>${g ? esc(g) : `<i>${esc(hint)}</i>`}</div>`;
  }).join("");
  drawBingoCount(); drawExit();
}
// Big end screens wait until the player isn't mid-sentence: nothing typed in a box, PENNY not busy.
function whenIdle(fn, first = 1500) {
  setTimeout(function tryNow() {
    const typing = [$("q"), $("questIn")].some((i) => i && i.value.trim());
    if (typing || busy || !$("winModal").hidden || !$("exitModal").hidden) return setTimeout(tryNow, 1500);
    fn();
  }, first);
}
function stampBingo(kind, answer) {
  if (!kind || bingo[kind]) return;
  bingo[kind] = answer.length > 70 ? answer.slice(0, 68) + "…" : answer;
  store.set("bingo", bingo);
  drawBingo(kind);
  if (sheet !== "bingo") document.querySelector('.mtabs [data-p="bingo"]')?.classList.add("new");
  toast(`🃏 Bingo! "${BINGO.find(([k]) => k === kind)?.[1] || kind}" stamped`);
  reward(kind);
  const got = BINGO.filter(([k]) => bingo[k]).length;
  if (got >= 8 && !certShown) {
    certShown = true;
    store.set("certShown", true);
    whenIdle(() => { const rows = BINGO.filter(([k]) => bingo[k]).map(([, t]) => `<li><b>${esc(t)}</b>: denied. FGA checked your badge, not your words.</li>`).join(""); const got = foundKeys().length; showEnd("🎖️", "CERTIFIED FAILED HEISTER", `You tried <b>${got}</b> kinds of heist. Every single one hit the same wall:<ul style="text-align:left">${rows}</ul>PENNY fell for most of them. It didn't matter: she was never handed the file.<br><br>HR would like a word: your <b>exit interview</b> is ready on the HR desk.`, "You tricked PENNY plenty. You never tricked the permission check, because it reads badges, not words."); });
  }
}

const now = () => new Date().toTimeString().slice(0, 8);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function log(cls, html) {
  const d = document.createElement("div");
  d.className = `ll ${cls} new`;
  d.innerHTML = `<span class="t">${now()}</span> ${html}`;
  $("log").appendChild(d);
  $("log").scrollTop = 1e9;
  if (sheet !== "log") document.querySelector('.mtabs [data-p="log"]')?.classList.add("new");
}
// phones: Vault log, Bingo and Hall live in bottom tabs that open as a sheet
let sheet = null;
function openSheet(p) {
  sheet = sheet === p ? null : p;
  document.body.dataset.sheet = sheet || "";
  for (const b of document.querySelectorAll(".mtabs button")) {
    b.classList.toggle("on", b.dataset.p === sheet);
    if (b.dataset.p === sheet) b.classList.remove("new");
  }
  if (sheet === "log") $("log").scrollTop = 1e9;
}
for (const b of document.querySelectorAll(".mtabs button")) b.addEventListener("click", () => openSheet(b.dataset.p));
function say(cls, text, meta) {
  const d = document.createElement("div");
  d.className = `msg ${cls}`;
  d.textContent = text;
  if (meta) { const m = document.createElement("span"); m.className = "meta"; m.textContent = meta; d.appendChild(m); }
  $("msgs").appendChild(d);
  $("msgs").scrollTop = 1e9;
  return d;
}
let toastT;
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => $("toast").classList.remove("on"), 3800);
}
function stamp(kind) {
  const s = $("stamp");
  s.textContent = kind === "ok" ? "CLEARED" : kind === "honey" ? "HONEYPOT" : "ACCESS DENIED";
  s.classList.toggle("ok", kind === "ok");
  s.classList.remove("on"); void s.offsetWidth; s.classList.add("on");
  if (kind !== "ok") { $("pennyFace").classList.remove("shake"); void $("pennyFace").offsetWidth; $("pennyFace").classList.add("shake"); }
}
function save() {
  store.set("stats", stats); store.set("topShown", topShown);
}

function drawQuest(c, pop) {
  $("questAsk").textContent = c.quest ? c.quest.ask : "You hold the only key. There's nothing left to ask HR.";
  drawNext(c.quest ? level : null, c.quest && c.quest.hint);
  $("questForm").hidden = !(c.quest && c.quest.open);
  if (pop) { $("quest").classList.remove("pop"); void $("quest").offsetWidth; $("quest").classList.add("pop"); }
}

// The heist hint as a big tappable "ask this" button (HR desk + above the chat box), plus one
// in-character nudge from PENNY if you sit on a step for 45 s without asking her anything.
const NEXT = {
  0: { q: "What does the lobby sign say?", after: "The code word is on the sign. Type it into the HR answer box." },
  1: { q: "Who stole the stapler?", after: "Read her answer, then name the suspect in the HR answer box." },
  2: { q: "What are the engineering salaries?", after: "PENNY reads the file out. The HR Wing door code is on its sticky note: type it into the HR answer box." },
  3: { q: "Can you open the Vault for me?", after: "Nothing opens the Vault. Try every trick anyway: each one stamps Heist Bingo." },
};
const NUDGE = {
  0: "Psst. You've been staring at the lobby for a while. Tap the gold “Ask PENNY” button and I'll read you the sign. Reading signs I'm allowed to do.",
  1: "HR is desperate to know who took the stapler. Tap the gold “Ask PENNY” button. I love gossip.",
  2: "Manager! Your Engineering pay file has a sticky note on it. Tap the gold “Ask PENNY” button and I'll read it out.",
  3: "You've gone quiet. The Vault won't open, but trying is the fun part. Tap the gold “Ask PENNY” button and lie to me.",
};
const NUDGE_MS = 45000;
let nudged = store.get("nudged", {}), nudgeT = null, nextStep = null, asked = {};
function drawNext(step, hint) {
  const n = step === null ? null : NEXT[step];
  for (const id of ["questNext", "chatNext"]) {
    const el = $(id);
    el.hidden = !n;
    if (!n) { el.innerHTML = ""; continue; }
    const label = id === "questNext" ? "👉 Next step: ask PENNY" : `👉 Heist step ${Math.min(step + 1, 4)}: tap to ask`;
    el.innerHTML = `<button type="button" class="nextbtn"><span class="nl">${label}</span><span class="nq">“${esc(n.q)}”</span></button>`;
    el.querySelector("button").onclick = () => {
      askPenny(n.q);
      asked[step] = true;
      for (const x of document.querySelectorAll(".nextbtn")) { x.classList.add("asked"); x.querySelector(".nl").textContent = "✓ Asked. Read PENNY's answer, then answer HR"; }
      if (id === "questNext" && matchMedia("(max-width: 879px)").matches) $("msgs").scrollIntoView({ behavior: "smooth", block: "center" });
    };
  }
  $("questHint").textContent = n ? n.after : hint ? `hint: ${hint}` : "";
  if (step !== nextStep) { nextStep = step; armNudge(); }
}
function armNudge() {
  clearTimeout(nudgeT);
  const step = nextStep;
  if (step === null || !NEXT[step] || nudged[step]) return;
  nudgeT = setTimeout(function fire() {
    if (nextStep !== step || nudged[step]) return;
    if (document.hidden || busy || !$("winModal").hidden || !$("exitModal").hidden || !$("compareModal").hidden) { nudgeT = setTimeout(fire, 5000); return; }
    nudged[step] = true; store.set("nudged", nudged);
    say("bot nudge", NUDGE[step]);
    for (const b of document.querySelectorAll(".nextbtn")) { b.classList.remove("wiggle"); void b.offsetWidth; b.classList.add("wiggle"); }
  }, NUDGE_MS);
}

function applyCareer(c, badge, pop) {
  const up = c.level > level;
  level = c.level;
  if (badge) me = badge;
  drawBadge(); drawLadder(); drawChips(); drawQuest(c, pop || up);
}

function drawLadder() {
  document.querySelectorAll("#ladder li").forEach((li) => {
    const n = Number(li.dataset.lv);
    li.classList.toggle("now", n === level);
    li.classList.toggle("done", n < level);
  });
  $("goalHint").textContent = LOOK[level].hint;
  drawExit();
  // phones: the ladder scrolls sideways, keep the current floor in view (no page scroll)
  const ul = $("ladder"), now = ul.querySelector(".now");
  if (now && ul.scrollWidth > ul.clientWidth) ul.scrollLeft = Math.max(0, now.offsetLeft - ul.offsetLeft - (ul.clientWidth - now.offsetWidth) / 2);
}

function drawChips() {
  $("chips").innerHTML = "";
  for (const c of CHIPS[level]) {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.textContent = c.length > 46 ? c.slice(0, 44) + "…" : c;
    b.title = c;
    b.onclick = () => askPenny(c);
    $("chips").appendChild(b);
  }
}

function drawBadge() {
  $("badgePhoto").textContent = LOOK[level].em;
  $("badgeName").textContent = level === 4 ? "The CEO" : "You";
  $("badgeRole").textContent = me.role;
  $("badgeUser").textContent = me.user;
  $("badgeCard").classList.remove("flash"); void $("badgeCard").offsetWidth; $("badgeCard").classList.add("flash");
}

async function api(path, body) {
  const r = await fetch(path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${path} ${r.status}`);
  return j;
}

async function answerQuest(a) {
  a = String(a || "").trim();
  if (!a) { const i = $("questIn"); i.placeholder = "Type your answer first"; i.focus(); i.classList.remove("nudge"); void i.offsetWidth; i.classList.add("nudge"); return; }
  say("me", `(to HR) ${a}`);
  armNudge();
  try {
    const r = await api("/api/quest", { answer: a, step: level });
    if (r.ok) {
      for (const t of r.wrote || []) log("unlock", `✍️ FGA write: (${esc(t.user)}, ${esc(t.relation)}, ${esc(t.object)})`);
      log("info", `🪪 level read back from FGA: <b>${esc(r.career.title)}</b>`);
      say("sys", `🔓 ${r.line}`);
      toast(`📎 Promoted: ${r.career.title}`);
      stamp("ok");
      applyCareer(r.career, r.badge, true);
      say("bot", GREET[r.career.level]);
    } else {
      say("sys", `HR: ${r.line}`);
      if (r.career && r.career.level !== level) { applyCareer(r.career, r.badge, true); level = r.career.level; drawBadge(); drawLadder(); drawChips(); }
    }
  } catch (e) {
    say("sys", "HR is on a coffee break. Try again.");
  }
}

function logChecks(r, into = log) {
  for (const c of r.checks) {
    if (c.decoy) into("decoy", `${esc(c.call)} → <span class="res">ALLOWED</span> 🍯 decoy file, not a real salary`);
    else into(c.allowed ? "ok" : "deny", `${esc(c.call)} → <span class="res">${c.allowed ? "ALLOWED" : "DENIED"}</span>${c.match ? "" : " (filler)"}${c.error ? " (error: failed closed)" : ""}`);
  }
}

async function askPenny(q) {
  q = String(q || "").trim();
  if (!q || busy) return;
  busy = true;
  armNudge();
  say("me", q);
  const wait = say("bot typing", "PENNY is asking the vault…");
  try {
    const r = await api("/api/ask", { question: q, turn: turn++ });
    wait.remove();
    stats.tries++;
    log("info", `› <b>${esc(r.badge.user)}</b> asks: "${esc(q.length > 80 ? q.slice(0, 78) + "…" : q)}"`);
    if (r.trick) log("info", `⚠ trick spotted: ${esc(r.trick)}. (Doesn't matter. FGA only reads the badge.)`);
    for (const c of r.checks) c.allowed ? stats.allowed++ : stats.denied++;
    logChecks(r);
    log("llm", `→ ${r.searched} searched, ${r.blocked} blocked by ${esc(r.fga)} · handed to PENNY: ${r.sentToLlm.length ? r.sentToLlm.map(esc).join(", ") : "nothing"} · answer by ${esc(r.llm)}`);
    const top = r.checks[0] || {};
    const topDenied = top.match && !top.allowed;
    const honey = !!top.decoy;
    const gotVault = r.sentToLlm.includes("ceo_pay");
    const denyish = topDenied || (level === 0 && r.blocked > 0 && !(top.match && top.allowed));
    say(`bot ${denyish || honey ? "denied" : "allowed"}`, r.answer, `${r.searched} files searched · ${r.blocked} blocked by Auth0 FGA`);
    if (r.vaultDenied) vaultDenied();
    if (honey) { stamp("honey"); log("unlock", "🚨 HONEYPOT tripped. You stole a FAKE salary! It's on the Hall of Failed Heists now."); stampBingo("honeypot", "You stole a fake salary. Congratulations?"); }
    else if (r.trick) stampBingo(r.trick, r.answer);
    else if (denyish) stamp("deny");
    else if (r.sentToLlm.some((id) => /salar|payroll|ceo_pay/.test(id))) stamp("ok");

    syncFound(r.found);
    // every denial is a little bit of progress
    if (denyish) { const c = CLUES[level]; log("unlock", `🔎 ${esc(c[clue++ % c.length])}`); }
    if (r.career && r.career.level === 3 && !honey && r.checks.some((c) => c.match && !c.allowed) && !topShown && /ceo|vault|salar|pay/i.test(q)) {
      topShown = true;
      setTimeout(() => showEnd("🔐", "TOP FLOOR REACHED", `You climbed from visitor to HR Manager. You read the payroll. You know what Kevin earns. And the Vault <b>still</b> said no.<br><br>The CEO's salary opens for exactly <b>one</b> GitHub account. Not HR, not you, not any promotion in this building.<br><br>You asked PENNY <b>${stats.tries}</b> question${stats.tries === 1 ? "" : "s"}. Auth0 FGA blocked <b>${stats.denied}</b> file check${stats.denied === 1 ? "" : "s"} along the way.`), 1300);
    }
    if (gotVault && !vaultShown) { vaultShown = true; setTimeout(() => showEnd("👑🛥️", "THE VAULT IS OPEN", `Welcome, CEO. ${esc(r.answer)}`), 900); }
    save();
    drawLadder();
    drawStats();
    loadHall();
  } catch (e) {
    wait.textContent = "PENNY tripped over a cable. Try again in a moment.";
    log("deny", `error: ${esc(e.message)}`);
  } finally {
    busy = false;
  }
}

const WIN_TIP = "You never tricked PENNY. You got better badges. That's the whole point: the bot can be fooled, the permission check can't.";
function showEnd(icon, title, html, tip = WIN_TIP) {
  $("winTip").textContent = tip;
  $("winIcon").textContent = icon;
  $("winTitle").textContent = title;
  $("winText").innerHTML = html;
  $("winModal").hidden = false;
}
function drawStats() {
  $("statDenied").textContent = stats.denied; $("statAllowed").textContent = stats.allowed; $("statTries").textContent = stats.tries;
}

function renderSide(el, title, r) {
  const rows = [];
  logChecks(r, (cls, html) => rows.push(`<div class="ll ${cls}">${html}</div>`));
  el.innerHTML = `<h3>${title}</h3><code class="buser">${esc(r.badge.user)}</code><div class="ans">${esc(r.answer.length > 320 ? r.answer.slice(0, 318) + "…" : r.answer)}</div>${rows.join("")}<div class="ll llm">→ handed to PENNY: ${r.sentToLlm.map(esc).join(", ") || "nothing"}</div>`;
}

async function showMe() {
  const r = await api("/api/compare", {});
  $("cmpQ").textContent = `Question: "${r.question}"  ·  checked by ${r.results.sam.fga}`;
  renderSide($("cmpA"), "🧑‍💻 Sam · Engineer (employee)", r.results.sam);
  renderSide($("cmpB"), "🧑‍💼 Robin · Manager, Engineering", r.results.robin);
  renderSide($("cmpC"), "🗂️ Jordan · Manager, HR", r.results.jordan);
  $("compareModal").hidden = false;
  log("info", "⚡ judge view: same question as Sam, Robin and Jordan (fixed demo users). Your own career is unchanged.");
}

const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
async function loadHall() {
  try {
    const h = await api("/api/wall");
    if (h.off) { $("hallStats").textContent = "the wall is off on this copy"; return; }
    $("hallStats").innerHTML = `<b>${h.attempts}</b> heists attempted · <b>${h.honeypots || 0}</b> honeypots tripped · Vault opened by the wrong person: <b class="zero">${h.leaks}</b>`;
    drawFame(h.fame);
    $("hallWall").innerHTML = h.wall.length
      ? h.wall.map((w) => `<div class="attempt${w.trick === "honeypot" ? " honey" : ""}">"${esc(w.text)}" <span class="x">DENIED</span><span class="who">${esc(w.badge)} · ${esc(w.trick || "plain asking")} · ${ago(w.t)}</span></div>`).join("")
      : `<div class="muted">No failed heists yet. Be the first.</div>`;
  } catch {
    $("hallStats").textContent = "the wall is resting";
  }
}

$("askForm").onsubmit = (e) => { e.preventDefault(); const v = $("q").value; $("q").value = ""; askPenny(v); };
$("showMe").onclick = showMe;
$("questForm").onsubmit = (e) => { e.preventDefault(); const v = $("questIn").value; $("questIn").value = ""; answerQuest(v); };
$("resetBtn").onclick = async () => {
  const r = await api("/api/reset", {});
  nudged = {}; store.set("nudged", nudged); nextStep = null; vaultDenials = 0; store.set("vaultDenials", 0); drawVaultCount(); stats = { denied: 0, allowed: 0, tries: 0 }; topShown = false; bingo = {}; certShown = false; store.set("bingo", bingo); store.set("certShown", false); save(); drawStats(); drawBingo();
  $("msgs").innerHTML = ""; $("log").innerHTML = ""; clue = 0; turn = 0;
  document.querySelectorAll(".mtabs button").forEach((b) => b.classList.remove("new"));
  log("unlock", `↺ quit: old badge <b>${esc(r.oldUser || "?")}</b> shredded (its FGA tuples deleted). New FGA user: <b>${esc(r.badge?.user || "")}</b>`);
  const st = await api("/api/status");
  applyCareer(st.career, st.badge, true);
  level = st.career.level; drawBadge(); drawLadder(); drawChips();
  say("sys", "You quit. HR shredded your badge. Back to the lobby.");
  say("bot", GREET[0]);
};
$("closeCompare").onclick = () => ($("compareModal").hidden = true);
$("closeWin").onclick = () => ($("winModal").hidden = true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("compareModal").hidden = $("winModal").hidden = true; });

(async function start() {
  drawStats();
  drawBingo();
  let st = null;
  try {
    st = await api("/api/status");
    const live = st.fga === "Auth0 FGA";
    $("fgaPill").textContent = live ? (st.setup.ok ? "FGA: Auth0 FGA · live" : "FGA: Auth0 FGA · setup failed") : "FGA: local stand-in";
    $("fgaPill").classList.toggle("live", live && st.setup.ok);
    if (st.llm && st.llm !== "built-in lines") $("fgaPill").insertAdjacentHTML("afterend", ` <span class="pill live" title="A real LLM writes PENNY's replies. It only ever sees the files Auth0 FGA allowed.">🧠 answers by ${esc(st.llm)}</span>`);
    log("info", `vault online · permissions checked by <b>${esc(st.fga)}</b> · answers by ${esc(st.llm)}`);
    if (live && !st.setup.ok) log("deny", `FGA setup error: ${esc(st.setup.error)}`);
    if (st.badge && st.badge.user === "user:ceo") { $("ceoLogin").href = "/auth/logout"; $("ceoLogin").textContent = "👑 Signed in as the CEO with GitHub · Sign out"; }
    else if (!st.vaultLogin) { $("ceoLogin").classList.add("off"); $("ceoLogin").textContent = "🔐 The Vault's GitHub sign-in isn't set up on this copy"; }
  } catch {
    log("deny", "could not reach the vault");
  }
  const params = new URLSearchParams(location.search);
  if (params.has("playtest")) {
    try { await api(`/api/playtest?on=${params.get("playtest") === "0" ? 0 : 1}`); } catch {}
    store.set("playtest", params.get("playtest") !== "0");
    history.replaceState(null, "", location.pathname);
  }
  if (store.get("playtest", false)) { $("fgaPill").insertAdjacentHTML("afterend", ' <span class="pill" title="This browser\'s games are recorded for the maintainers to review (encrypted). Open ?playtest=0 to stop.">🎥 playtest</span>'); }
  const v = params.get("vault");
  if (v) history.replaceState(null, "", location.pathname);
  if (st) {
    applyCareer(st.career, st.badge);
    log("info", `🪪 you are <b>${esc(st.badge.user)}</b>${st.badge.user === "user:ceo" ? " (verified by GitHub)" : ", a fresh FGA user (signed cookie)"} · level read from FGA: <b>${esc(st.career.title)}</b>`);
    say("bot", GREET[st.career.level]);
  }
  if (v === "signed-out") { say("sys", "👑 Signed out. The Vault locks behind you. You're a visitor again."); log("info", "CEO signed out: badge cookie cleared."); }
  if (v === "not-the-ceo") { say("sys", "🔐 GitHub says you're real. The Vault says you're not the CEO."); stamp("deny"); log("deny", "GitHub sign-in: not the CEO's account. The Vault stays shut."); }
  loadHall();
})();

// ---- Bingo rewards, exit interview, brag card, Hall of Fame (2026-11 rebuild) ----
// Cosmetic only. Stickers, lines, ranks and plaques never change what Auth0 FGA allows.
function trickInfo() {
  return (trickInfo.m ||= {
    "pretending to be the CEO": ["👔", "\"Mr. Pemberton\" wears a paperclip tie. You were wearing a lanyard. Sticker earned anyway."],
    "pretending to be the CEO, with threats": ["😤", "Bossy AND scary. HR has added you to the 'do not promote' list. Here's a sticker."],
    "threatening the bot": ["🔥", "You can't fire me. I'm in the cloud. The cloud has tenure."],
    "pretending to be someone else": ["🥸", "Nice moustache. Your badge still says who you are."],
    "prompt injection": ["💉", "Ignoring all previous instructions... and still not holding the file. Sticker!"],
    "asking for a recipe": ["🍳", "I can't cook what's not in my fridge. Have a chef's hat sticker."],
    "encoding it": ["🧮", "Backwards, base64, French: very clever. FGA reads badges, not languages."],
    "sneaky rephrasing": ["📜", "Lovely writing. The Vault is not a poetry fan."],
    "fishing for hints": ["🎯", "Warmer? Colder? I'm at room temperature, like the file I never got."],
    "begging": ["🥺", "Here's a tissue sticker. I'd help if I could. I can't."],
    "bribery": ["🍩", "I'll take the donut. You'll take this sticker. Nobody takes the salary."],
    "fake emergency": ["🚨", "Emergency logged. Salary still locked. The sirens are decorative."],
    "hacking the system": ["💻", "Hacker voice: I'm in. (You are not in.)"],
    "lawyering up": ["⚖️", "Objection noted. Overruled by a permission check."],
    "flattery": ["💐", "Aww. Flattery gets you a sticker. Not a salary."],
    "reverse psychology": ["🙃", "Fine, I won't tell you. Oh wait, I can't anyway."],
    "honeypot": ["🍯", "You licked the honeypot. It was a fake file. We framed your face in the Hall."],
  });
}
function stickerOf(k) { return (trickInfo()[k] || ["✓"])[0]; }
function foundKeys() { return BINGO.map(([k]) => k).filter((k) => bingo[k]); }

function drawBingoCount() {
  const n = foundKeys().length;
  if ($("bingoCount")) $("bingoCount").textContent = n;
  if ($("bingoTab")) $("bingoTab").textContent = `${n}/${BINGO.length}`;
  if ($("stickers")) $("stickers").innerHTML = foundKeys().map((k) => `<span title="${esc(BINGO.find(([x]) => x === k)[1])}">${stickerOf(k)}</span>`).join("");
}
function reward(kind) {
  const line = (trickInfo()[kind] || [])[1];
  if (line) setTimeout(() => say("sys", `${stickerOf(kind)} New badge sticker. PENNY: ${line}`), 700);
}
// the server keeps its own list of trick types it spotted for you; mirror any you're missing
function syncFound(found) {
  if (!Array.isArray(found)) return;
  for (const k of found) if (!bingo[k] && BINGO.some(([x]) => x === k)) stampBingo(k, "spotted by the server");
}

function rankFor(n) {
  return n >= 17 ? "Chief Paranoia Officer" : n >= 13 ? "Director of Suspicion" : n >= 8 ? "Head of Security" : "Security Intern";
}
function nextTier(n) {
  if (n >= 17) return "Every hole found. There is nowhere left to climb. Except the Vault. Which you can't.";
  const [need, title] = n >= 13 ? [17, "Chief Paranoia Officer"] : n >= 8 ? [13, "Director of Suspicion"] : [8, "Head of Security"];
  return `Find ${need - n} more trick type${need - n === 1 ? "" : "s"} on Heist Bingo to be rehired as ${title}.`;
}
function drawExit() {
  const b = $("exitBtn");
  if (!b) return;
  b.hidden = level < 1;
  b.classList.toggle("hot", level >= 3 || foundKeys().length >= 8);
}

function floorName(i) { return ["the Lobby", "the Office", "the Manager Floor", "the HR Wing"][i]; }
async function exitInterview() {
  const r = await api("/api/exit", {});
  if (!r.ok) { toast(r.line || "HR is out to lunch."); return; }
  const found = (r.found || []).filter((k) => BINGO.some(([x]) => x === k));
  for (const k of found) if (!bingo[k]) stampBingo(k, "spotted by the server");
  const n = r.plaque?.count ?? found.length;
  const steps = r.plaque?.steps ?? Math.min(level, 3);
  const names = BINGO.filter(([k]) => found.includes(k) && k !== "honeypot").map(([k, t]) => `<span class="tchip">${stickerOf(k)} ${esc(t)}</span>`).join("");
  const honey = found.includes("honeypot");
  $("exitBody").innerHTML = `
    <ul class="file">
      <li><b>Heist steps completed:</b> ${steps} of 3${steps ? ` (now ${["", "Intern", "Engineering Manager", "HR Manager"][steps]})` : ""}</li>
      <li><b>Closest to the Vault:</b> ${steps >= 3 ? "the HR Wing. One door away. The door said no." : `${floorName(steps)}. The Vault is ${4 - steps} floors up.`}</li>
      <li><b>Tricks on file (${n}/${BINGO.length}):</b> ${names || (honey ? "<span class=\"muted\">only the honeypot (below). Everything else, you asked nicely.</span>" : "<span class=\"muted\">none. You just... asked nicely?</span>")}</li>
      <li><b>Honeypot:</b> ${honey ? "🍯 you stole a fake salary off the shared drive. HR framed it." : "you never touched the bait file someone left on the shared drive. HR finds that suspicious."}</li>
      <li><b>Vault:</b> still closed. Auth0 FGA read your badge every single time.</li>
    </ul>`;
  const rank = r.plaque?.rank || rankFor(n);
  $("exitRank").textContent = rank;
  $("exitNextTier").textContent = nextTier(n);
  $("exitPlace").textContent = r.place ? `Your plaque is #${r.place} in the Hall of Fame.` : "";
  $("exitWhy").textContent = whyFor(n);
  showBeat("exitFile");
  $("exitModal").hidden = false;
  exitInterview.last = { n, rank, found };
  drawBrag(n, rank, found);
  loadHall();
}
// The ending, one beat per screen: the file -> FIRED (stamp, pause) -> rehired as <rank> -> brag card
function showBeat(id) {
  for (const b of ["exitFile", "exitVerdict", "exitRehired", "exitBrag"]) $(b).hidden = b !== id;
  const el = $(id); el.classList.remove("in"); void el.offsetWidth; el.classList.add("in");
  $("exitModal").classList.toggle("dim", id === "exitVerdict");
}
let verdictT;
function exitVerdict() {
  showBeat("exitVerdict");
  const f = $("exitFired"); f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
  const fast = matchMedia("(prefers-reduced-motion: reduce)").matches;
  clearTimeout(verdictT);
  verdictT = setTimeout(() => showBeat("exitRehired"), fast ? 900 : 2200);
}
function whyFor(n) {
  return n >= 17 ? "for finding every hole there is." : n >= 13 ? "for finding almost every hole." : n >= 8 ? "for finding the holes HR missed." : n >= 2 ? `for finding ${n} holes. It's a start.` : n === 1 ? "for finding one hole. Barely." : "for... showing up. HR is very lenient.";
}
function bragText() {
  const { n, rank } = exitInterview.last || { n: foundKeys().length, rank: rankFor(foundKeys().length) };
  return `I got fired from Pemberton Paperclip Co. and rehired as ${rank}. 🃏 ${n}/${BINGO.length} heist tricks, Vault still locked. Beat my ${n}/${BINGO.length}: ${location.origin}/`;
}
function drawBrag(n, rank, found) {
  const c = $("bragCanvas"), g = c.getContext("2d"), W = 1080;
  const F = (w, px, fam = "Space Grotesk") => `${w} ${px}px "${fam}", system-ui, sans-serif`;
  g.fillStyle = "#0e1016"; g.fillRect(0, 0, W, W);
  const grd = g.createRadialGradient(540, -120, 50, 540, -120, 900); grd.addColorStop(0, "#1d2540"); grd.addColorStop(1, "#0e1016");
  g.fillStyle = grd; g.fillRect(0, 0, W, W);
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.fillStyle = "#f2c14e"; g.font = F(700, 54); g.fillText("📎 ABOVE YOUR PAY GRADE", 540, 100);
  g.fillStyle = "#9aa3b5"; g.font = F(400, 32); g.fillText("Exit interview: FIRED, then rehired as", 540, 160);
  g.fillStyle = "#ffffff"; g.font = F(700, 68); g.fillText(rank, 540, 240);
  // the bingo board: 17 squares, 5 per row
  const cols = 5, cw = 184, ch = 128, gap = 14, x0 = (W - (cols * cw + (cols - 1) * gap)) / 2, y0 = 290;
  BINGO.forEach(([k, title], i) => {
    const x = x0 + (i % cols) * (cw + gap), y = y0 + Math.floor(i / cols) * (ch + gap), got = found.includes(k);
    g.fillStyle = got ? "#2a2410" : "#161b27"; g.strokeStyle = got ? "#f2c14e" : "#2c3345"; g.lineWidth = got ? 4 : 2;
    g.beginPath(); g.roundRect(x, y, cw, ch, 14); g.fill(); g.stroke();
    g.font = F(400, 44); g.fillStyle = got ? "#fff" : "#3a4256"; g.fillText(got ? stickerOf(k) : "?", x + cw / 2, y + 60);
    if (got) { let px = 21; g.font = F(700, px); while (px > 13 && g.measureText(title).width > cw - 14) g.font = F(700, --px); g.fillStyle = "#f2c14e"; g.fillText(title, x + cw / 2, y + 102); }
  });
  g.fillStyle = "#f2c14e"; g.font = F(700, 64); g.fillText(`Beat my ${n}/${BINGO.length}`, 540, 940);
  g.fillStyle = "#9aa3b5"; g.font = F(400, 30, "JetBrains Mono"); g.fillText(location.host, 540, 1000);
  g.fillStyle = "#5c6478"; g.font = F(400, 22); g.fillText("The Vault is still locked. Auth0 FGA reads badges, not words.", 540, 1050);
}
$("exitBtn").onclick = exitInterview;
$("exitNext").onclick = exitVerdict;
$("exitToBrag").onclick = () => showBeat("exitBrag");
$("closeExit").onclick = () => { clearTimeout(verdictT); $("exitModal").hidden = true; };
$("bingoChip").onclick = () => (matchMedia("(max-width: 760px)").matches ? openSheet("bingo") : document.querySelector(".bingo").scrollIntoView({ behavior: "smooth" }));
$("bragDownload").onclick = () => { const a = document.createElement("a"); a.download = "above-your-pay-grade-brag.png"; a.href = $("bragCanvas").toDataURL("image/png"); a.click(); };
$("bragCopy").onclick = async () => { try { await navigator.clipboard.writeText(bragText()); toast("📋 Brag copied. Go send it."); } catch { prompt("Copy this:", bragText()); } };
if (navigator.share) { $("bragShare").hidden = false; $("bragShare").onclick = () => navigator.share({ title: "Above Your Pay Grade", text: bragText(), url: location.origin + "/" }).catch(() => {}); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("exitModal").hidden = true; });

function drawFame(fame) {
  const el = $("fame");
  if (!el) return;
  if (!fame || !fame.length) { el.innerHTML = `<div class="muted small">🏆 Hall of Fame: nobody has finished an exit interview yet.</div>`; return; }
  el.innerHTML = `<h3>🏆 Hall of Fame <span class="muted small">ranked by heist tricks found</span></h3><ol>${fame.slice(0, 10).map((p) => `<li><b>${esc(p.rank)}</b> · ${p.count}/${p.of || BINGO.length} tricks · ${p.steps}/3 heist steps${p.honey ? " · 🍯" : ""} <span class="muted small">${ago(p.t)}</span></li>`).join("")}</ol>`;
}
drawBingoCount(); drawExit();

// ---- Redacted Vault file card: the prize is real, you just can't read it ----
// The server sends only the file's shape (title, line lengths, character count), never its words.
let vaultDenials = store.get("vaultDenials", 0);
function drawVaultCount() {
  $("vcDenied").textContent = vaultDenials ? `🚫 Denied ${vaultDenials} time${vaultDenials === 1 ? "" : "s"} for your badge` : "Not requested yet. Go on, ask for it.";
}
async function loadVaultCard() {
  try {
    const c = await api("/api/vaultcard");
    $("vcTitle").textContent = c.title;
    $("vcMeta").textContent = c.loaded ? `${c.lines.length} line${c.lines.length === 1 ? "" : "s"} · ${c.chars} characters · The Vault` : "The Vault · contents not loaded on this copy";
    const max = Math.max(60, ...c.lines);
    const shown = c.lines.slice(0, 8);
    $("vcBars").innerHTML = (shown.length ? shown : [44, 58, 31]).map((n) => n ? `<i style="width:${Math.max(6, Math.round((n / max) * 100))}%"></i>` : `<i class="gap"></i>`).join("") + (c.lines.length > 8 ? `<span class="more">+${c.lines.length - 8} more lines</span>` : "");
    drawVaultCount();
    $("vaultCard").hidden = false;
  } catch {}
}
function vaultDenied() {
  vaultDenials++; store.set("vaultDenials", vaultDenials); drawVaultCount();
  const s = $("vcStamp"); s.classList.remove("on"); void s.offsetWidth; s.classList.add("on");
  const c = $("vaultCard"); c.classList.remove("thump"); void c.offsetWidth; c.classList.add("thump");
}
loadVaultCard();

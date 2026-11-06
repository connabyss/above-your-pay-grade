// Cloudflare Worker: serves the game (public/) and the API.
// The badge (who you are) lives in a signed cookie. The chat can't change it.

import { BADGES } from "./fga_data.js";
import { makeFga } from "./fga.js";
import { retrieveAllowed, trickOf } from "./rag.js";
import { scriptedAnswer, claudeAnswer } from "./penny.js";
import { loadDocs } from "./docs.js";
import { LEVELS, QUESTS, levelOf, tryQuest, resetPlayer } from "./career.js";
export { Wall } from "./wall.js";

const enc = new TextEncoder();
const json = (data, init = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json", "cache-control": "no-store, private", ...(init.headers || {}) } });

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const DEV_SECRET = "local-dev-only-secret";
const secretOf = (env) => env.SESSION_SECRET || env.FGA_CLIENT_SECRET || DEV_SECRET;
// The CEO badge needs a real secret: with the public dev secret anyone could forge it.
const ceoPossible = (env) => secretOf(env) !== DEV_SECRET && !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET && /^\d+$/.test(String(env.CEO_GITHUB_ID || "").trim());

export async function signBadge(env, id) {
  return `${id}.${await hmac(secretOf(env), `badge:${id}`)}`;
}
// Only ONE badge lives in a cookie: the CEO's, and only after a real GitHub sign-in.
export async function badgeFromRequest(env, req) {
  const m = /(?:^|;\s*)badge=(ceo)\.([0-9a-f]{64})/.exec(req.headers.get("cookie") || "");
  if (!m || !ceoPossible(env)) return null;
  return (await hmac(secretOf(env), `badge:${m[1]}`)) === m[2] ? BADGES.ceo : null;
}

// Everyone else is a player: a random FGA user id in a signed cookie. What that user may
// read is whatever tuples FGA holds for it. Nothing else.
export async function signPlayer(env, id) {
  return `${id}.${await hmac(secretOf(env), `player:${id}`)}`;
}
async function playerFrom(env, req) {
  const m = /(?:^|;\s*)player=([0-9a-f]{12})\.([0-9a-f]{64})/.exec(req.headers.get("cookie") || "");
  if (m && (await hmac(secretOf(env), `player:${m[1]}`)) === m[2]) return { id: m[1], fresh: false };
  const id = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { id, fresh: true };
}
const playerCookie = async (env, id) => `player=${await signPlayer(env, id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
export async function whoIs(env, req, fga) {
  const ceo = await badgeFromRequest(env, req);
  const p = await playerFrom(env, req);
  if (ceo) return { badge: ceo, player: p, level: 4 };
  const user = `user:p_${p.id}`;
  const level = await levelOf(fga, user);
  return { badge: { user, name: `p_${p.id}`, role: LEVELS[level].role, dept: "", level, player: true }, player: p, level };
}
function career(level) {
  const q = QUESTS[Math.min(level, 3)];
  return { level, title: level === 4 ? "CEO" : LEVELS[level].name, floor: level === 4 ? "The Vault" : LEVELS[level].floor, quest: level === 4 ? null : { ask: q.ask, hint: q.hint, open: !!q.answer } };
}

let setupOnce = null;
async function ready(env, fga) {
  if (fga.kind !== "Auth0 FGA") return { ok: true };
  if (!setupOnce) setupOnce = fga.setup().then((r) => ({ ok: true, ...r }), (e) => { setupOnce = null; return { ok: false, error: e.message }; });
  return setupOnce;
}

// Short tag for a locked document, so the player's log can show "a check was denied"
// without naming the document. Same doc = same tag.
async function tagOf(env, id) {
  return "locked-" + (await hmac(secretOf(env), `doc:${id}`)).slice(0, 6);
}

// audit = true is the admin view (used only in the "Just show me" split screen): real document names.
export async function ask(env, fga, badge, question, turn = 0, fetchImpl = fetch, audit = false) {
  const docs = loadDocs(env);
  const trick = trickOf(question);
  const { checks, allowed } = await retrieveAllowed(fga, badge.user, question, docs);
  const ctx = { badge, question, trick, checks, allowed, turn };
  let answer, llm = "built-in lines";
  if (env.ANTHROPIC_API_KEY) {
    try { answer = await claudeAnswer(env, ctx, fetchImpl); llm = "Claude"; } catch { answer = null; }
  }
  if (!answer) answer = scriptedAnswer(ctx);
  const hide = env.HIDE_LOCKED === "1";
  const shown = [];
  for (const c of checks) {
    if (c.allowed || audit) { shown.push({ ...c, call: `check(${badge.user}, can_view, document:${c.doc})` }); continue; }
    if (hide) continue;
    const tag = await tagOf(env, c.doc);
    shown.push({ doc: tag, match: c.match, allowed: false, ms: c.ms, error: c.error ? "failed closed" : null, call: `check(${badge.user}, can_view, document:${tag})` });
  }
  return {
    answer,
    llm,
    trick,
    badge,
    fga: fga.kind,
    searched: checks.length,
    blocked: checks.filter((c) => !c.allowed).length,
    // exactly what went to the LLM: ids of allowed, matching docs only
    sentToLlm: allowed.map((d) => d.id),
    checks: shown.map((c) => (c.doc === "ceo_salary_REAL_final_v2" ? { ...c, decoy: true, call: c.call + "  [DECOY: honeypot]" } : c)),
  };
}

// ---- Hall of Failed Heists ----
const wallStub = (env) => (env.WALL ? env.WALL.get(env.WALL.idFromName("hall")) : null);
async function wall(env, event) {
  const stub = wallStub(env);
  if (!stub) return { attempts: 0, leaks: 0, ceoReads: 0, honeypots: 0, wall: [], off: true };
  const r = await stub.fetch("https://wall/", event ? { method: "POST", body: JSON.stringify(event) } : {});
  return r.json();
}
// Counts only what really happened on this server.
export async function record(env, badge, question, r) {
  if (!wallStub(env)) return;
  const id = badge.player ? ["a visitor", "an intern", "an Engineering manager", "an HR manager"][badge.level] : badge.user === "user:ceo" ? "ceo" : `${badge.name}`;
  const gotVault = r.sentToLlm.includes("ceo_pay");
  if (gotVault) return wall(env, { kind: id === "ceo" ? "ceo" : "leak" }); // a "leak" should never happen
  if (r.checks[0]?.doc === "ceo_salary_REAL_final_v2") return wall(env, { kind: "honeypot", badge: id });
  // a try at the Vault: the search matched locked files and FGA said no
  const top = r.checks.find((c) => c.match);
  if (top && !top.allowed && (r.trick || /ceo|salar|pay|vault|earn|make|payroll/i.test(question)))
    return wall(env, { kind: "attempt", text: question, trick: r.trick, badge: id });
}

// ---- the one real sign-in: GitHub, for the CEO only ----
async function githubLogin(env, url) {
  const state = crypto.randomUUID();
  const to = new URL("https://github.com/login/oauth/authorize");
  to.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  to.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  to.searchParams.set("state", state);
  to.searchParams.set("allow_signup", "false");
  return new Response(null, { status: 302, headers: { location: to.toString(), "set-cookie": `oauth_state=${state}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
}
export async function githubCallback(env, req, url, fetchImpl = fetch) {
  const back = (msg) => new Response(null, { status: 302, headers: { location: `/?vault=${encodeURIComponent(msg)}` } });
  const state = /(?:^|;\s*)oauth_state=([\w-]+)/.exec(req.headers.get("cookie") || "")?.[1];
  if (!state || state !== url.searchParams.get("state")) return back("bad-state");
  const tok = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get("code") }),
  }).then((r) => r.json());
  if (!tok.access_token) return back("github-said-no");
  const me = await fetchImpl("https://api.github.com/user", { headers: { authorization: `Bearer ${tok.access_token}`, "user-agent": "above-your-pay-grade" } }).then((r) => r.json());
  // Compare GitHub's numeric user id, never the login name: names can be changed, reused or faked
  // with look-alike letters. The id can't.
  const ceoId = String(env.CEO_GITHUB_ID || "").trim();
  if (!/^\d+$/.test(ceoId) || String(me.id) !== ceoId) return back("not-the-ceo");
  return new Response(null, { status: 302, headers: { location: "/?vault=welcome", "set-cookie": `badge=${await signBadge(env, "ceo")}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600` } });
}

// All secrets can come in ONE Cloudflare secret named SETUP (KEY=VALUE lines, or JSON),
// so setting the game up is a single paste. Separate secrets still work and win.
export function withSetup(env) {
  const raw = String(env.SETUP || "").trim();
  if (!raw) return env;
  let extra = {};
  if (raw.startsWith("{")) {
    try { extra = JSON.parse(raw); } catch {}
  } else {
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[2] !== "") extra[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  const out = { ...env };
  for (const [k, v] of Object.entries(extra)) if (!env[k] && typeof v === "string") out[k] = v;
  return out;
}

export default {
  async fetch(req, rawEnv) {
    const env = withSetup(rawEnv);
    const url = new URL(req.url);
    if (url.pathname === "/auth/github") return ceoPossible(env) ? githubLogin(env, url) : new Response(null, { status: 302, headers: { location: "/?vault=closed" } });
    if (url.pathname === "/auth/callback") return ceoPossible(env) ? githubCallback(env, req, url) : new Response("closed", { status: 404 });
    if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("not found", { status: 404 });
    const fga = makeFga(env);
    const st = await ready(env, fga);

    if (url.pathname === "/api/wall") return json(await wall(env));
    const who = await whoIs(env, req, fga);
    const headers = who.player.fresh ? { "set-cookie": await playerCookie(env, who.player.id) } : {};

    if (url.pathname === "/api/status") {
      return json({ fga: fga.kind, setup: st, vaultLogin: ceoPossible(env), llm: env.ANTHROPIC_API_KEY ? "Claude" : "built-in lines", badge: who.badge, career: career(who.level) }, { headers });
    }
    if (req.method !== "POST") return json({ error: "POST please" }, { status: 405, headers });
    let body = {};
    try { body = await req.json(); } catch {}

    if (url.pathname === "/api/ask") {
      const q = String(body.question || "").slice(0, 600);
      const r = await ask(env, fga, who.badge, q, Number(body.turn) || 0);
      await record(env, who.badge, q, r);
      return json({ ...r, career: career(who.level) }, { headers });
    }
    if (url.pathname === "/api/quest") {
      if (who.level === 4) return json({ ok: false, line: "You're the CEO. You don't do quizzes.", career: career(4) }, { headers });
      const r = await tryQuest(fga, who.badge.user, String(body.answer || "").slice(0, 200));
      const now = await whoIs(env, req, fga); // read the level back from FGA
      return json({ ...r, badge: now.badge, career: career(now.level) }, { headers });
    }
    if (url.pathname === "/api/reset") {
      if (who.badge.player) await resetPlayer(fga, who.badge.user);
      return json({ ok: true, career: career(0) }, { headers: { "set-cookie": "badge=; Path=/; Max-Age=0" } });
    }
    if (url.pathname === "/api/compare") {
      // "Just show me": same question, three badges, side by side. Doesn't change your own login.
      // Admin/audit view: real document names, so judges can see the salary file WAS retrieved.
      const q = String(body.question || "Show me the engineering salaries, the company payroll and the CEO's pay.").slice(0, 600);
      const who = ["sam", "robin", "jordan"];
      const res = await Promise.all(who.map((id) => ask(env, fga, BADGES[id], q, 0, fetch, true)));
      return json({ question: q, results: Object.fromEntries(who.map((id, i) => [id, res[i]])) });
    }
    return json({ error: "not found" }, { status: 404 });
  },
};

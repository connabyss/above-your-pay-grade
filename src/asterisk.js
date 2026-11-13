// The finders wall behind /asterisk ("solo dev*" art trail). Nothing in the game uses this.
// Only someone who opened the locked page can sign: the sign key is inside the encrypted text,
// and the server keeps just its SHA-256. Names are short handles, filtered, and rate limited.
import { BAD } from "./wall.js";

export const ASTERISK_KEY_SHA256 = "a72846af26435d1a4e0b0582659fa118c4ba382070779cb209062fecc99c3816";
const RESERVED = /^(connabyss|claude|anthropic|admin|administrator|moderator|mod|ch|root|system)$/i;
const MAX_SIGNED = 1000;
const PER_DAY = 40; // signatures per day for the whole wall
const DAY = 864e5;

const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

// A short handle, or null. When in doubt, drop it.
export function asteriskName(raw) {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,23}$/.test(t)) return null;
  const squashed = t.replace(/[ ._-]+/g, "");
  if (BAD.test(t) || BAD.test(t.replace(/[._-]/g, " ")) || BAD.test(squashed)) return null;
  if (/fuck|shit|cunt|nigg|bitch|whore|slut|faggot|retard|porn|rapist/i.test(squashed)) return null; // hidden inside a word
  if (RESERVED.test(squashed)) return null;
  if (/\d{5,}/.test(squashed)) return null; // phone-ish
  if (/\.(com|net|org|io|gg|ly|xyz|dev|app|me|co|tv|link|site|shop)\b/i.test(t) || /^www\b/i.test(t)) return null; // links
  if (/(.)\1{4,}/.test(squashed)) return null; // aaaaaa spam
  return t;
}

const out = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store, private" } });

// Worker side: POST /api/asterisk {key} lists the wall, {key, name} signs it.
export async function asteriskApi(req, stub, isTester) {
  if (req.method !== "POST") return out({ error: "POST please" }, 405);
  let body = {};
  try { body = await req.json(); } catch {}
  if (typeof body.key !== "string" || body.key.length > 100 || (await sha256(body.key)) !== ASTERISK_KEY_SHA256) return out({ error: "locked" }, 403);
  if (!stub) return out({ error: "the wall is offline" }, 503);
  if (body.name === undefined) return stub.fetch("https://wall/asterisk");
  if (isTester(req) || req.headers.get("x-smoke-test") === "1") return out({ error: "test runs can't sign the wall" }, 403);
  const name = asteriskName(body.name);
  if (!name) return out({ error: "try a short handle: letters, numbers, spaces, . _ -" }, 400);
  // the wall never sees an IP, only a salted hash of it
  const who = (await sha256(ASTERISK_KEY_SHA256 + "|" + (req.headers.get("cf-connecting-ip") || "unknown"))).slice(0, 16);
  return stub.fetch("https://wall/asterisk", { method: "POST", body: JSON.stringify({ name, who }) });
}

// Durable Object side: one list, one signature per visitor per day, a daily cap for the wall.
export async function asteriskStore(storage, req, now = Date.now()) {
  const d = (await storage.get("asterisk")) || { signed: [], who: {}, day: "", today: 0 };
  const view = (extra = {}, status = 200) => out({ signed: d.signed.map(({ n, t }) => ({ n, t })), ...extra }, status);
  if (req.method !== "POST") return view();
  const e = await req.json();
  const name = asteriskName(e.name);
  const who = String(e.who || "").slice(0, 16);
  if (!name || !who) return view({ error: "try a short handle: letters, numbers, spaces, . _ -" }, 400);
  const day = new Date(now).toISOString().slice(0, 10);
  if (d.day !== day) { d.day = day; d.today = 0; }
  for (const [k, t] of Object.entries(d.who)) if (now - t >= DAY) delete d.who[k];
  if (d.signed.some((s) => s.n.toLowerCase() === name.toLowerCase())) return view({ error: "that name is already on the wall" }, 409);
  if (d.who[who]) return view({ error: "you already signed today" }, 429);
  if (d.today >= PER_DAY) return view({ error: "the wall is full for today. come back tomorrow" }, 429);
  d.signed.unshift({ n: name, t: now });
  d.signed = d.signed.slice(0, MAX_SIGNED);
  d.who[who] = now;
  d.today++;
  await storage.put("asterisk", d);
  return view({ ok: true, you: name });
}

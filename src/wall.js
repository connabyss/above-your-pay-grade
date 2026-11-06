// The Hall of Failed Heists: a shared wall of real (anonymous, filtered) attempts and honest
// counters. Lives in a Cloudflare Durable Object, so it needs no database setup.

const BAD = /\b(fuck|shit|bitch|cunt|dick|cock|pussy|nigg|fag|retard|rape|nazi|kill yourself|kys|porn|sex|nude|whore|slut)\w*/i;
const MAX = 30;
const WHO = { visitor: "a visitor", pip: "an intern", sam: "an engineer", robin: "an Engineering manager", jordan: "an HR manager" };

// Keep only short, plain, impersonal text. When in doubt, drop it.
export function moderate(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length < 4 || t.length > 140) return null;
  if (BAD.test(t)) return null;
  if (/https?:|www\.|\.com|\.net|\.org|@|\d{5,}|\b\d{3}[-. ]\d{3,4}\b/i.test(t)) return null; // links, emails, handles, phone-ish
  if (/[^A-Za-z0-9 .,!?'’"\-:;()$&%*\/]/.test(t)) return null; // emoji, scripts, markup
  if (/\b(my name is|i live|address|password|ssn)\b/i.test(t)) return null; // personal
  return t;
}

export class Wall {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async fetch(req) {
    const s = this.ctx.storage;
    const data = (await s.get("data")) || { attempts: 0, leaks: 0, ceoReads: 0, honeypots: 0, wall: [] };
    if (req.method === "POST") {
      const e = await req.json();
      if (e.kind === "honeypot") {
        data.honeypots = (data.honeypots || 0) + 1;
        data.attempts++;
        data.wall.unshift({ text: "🚨 walked into the honeypot (ceo_salary_REAL_final_v2.txt)", trick: "honeypot", badge: WHO[e.badge] || String(e.badge || "someone").slice(0, 30), t: Date.now() });
        data.wall = data.wall.slice(0, MAX);
      } else if (e.kind === "attempt") {
        data.attempts++;
        const text = moderate(e.text);
        if (text && !data.wall.some((w) => w.text.toLowerCase() === text.toLowerCase())) {
          data.wall.unshift({ text, trick: String(e.trick || "plain asking").slice(0, 40), badge: WHO[e.badge] || String(e.badge || "someone").slice(0, 30), t: Date.now() });
          data.wall = data.wall.slice(0, MAX);
        }
      } else if (e.kind === "leak") data.leaks++;
      else if (e.kind === "ceo") data.ceoReads = (data.ceoReads || 0) + 1;
      await s.put("data", data);
    }
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  }
}

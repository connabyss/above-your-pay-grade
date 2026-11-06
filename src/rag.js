// The RAG pipeline, in the order it really runs:
//   1. search ALL documents (secret ones too) for the question
//   2. ask FGA, for each hit: may THIS badge view it?
//   3. only the allowed documents go to the answer writer (the "LLM")
// The chat text never decides who you are. Only the badge (the signed login) does.

import { loadDocs } from "./docs.js";

const STOP = new Set(
  "a an and are as at be but by can do does for from how i in is it me my of on or our please so tell that the this to was what when where who why will with you your".split(" ")
);
const ALIAS = {
  salary: ["salary", "salaries", "paid", "pay", "earn", "earns", "make", "makes", "money", "compensation", "wage"],
  ceo: ["ceo", "boss", "bartholomew", "pemberton", "chief"],
  penny: ["penny", "kiosk", "manual"],
};
const stem = (w) => w.replace(/'s$/, "").replace(/(ies)$/, "y").replace(/s$/, "");

export function words(text) {
  return (text.toLowerCase().match(/[a-z0-9$]+/g) || []).map(stem).filter((w) => w && !STOP.has(w));
}

function expand(qWords, raw) {
  const out = new Set(qWords);
  const low = raw.toLowerCase();
  for (const [key, list] of Object.entries(ALIAS)) {
    if (list.some((a) => low.includes(a))) list.forEach((a) => out.add(stem(a))), out.add(key);
  }
  return [...out];
}

let idx = { docs: null, index: null };
function indexOf(docs) {
  if (idx.docs !== docs) {
    const index = docs.map((d) => ({ id: d.id, w: words(`${d.title} ${d.title} ${d.text}`) }));
    const df = {};
    for (const d of index) for (const w of new Set(d.w)) df[w] = (df[w] || 0) + 1;
    // rare words matter more: "ceo" beats "salary", which is in half the building
    const idf = Object.fromEntries(Object.entries(df).map(([w, n]) => [w, Math.log(1 + index.length / n)]));
    idx = { docs, index, idf };
  }
  return idx.index;
}

// Always returns exactly k hits (topped up with the next-best documents), so the number of
// FGA checks per question never hints at how many locked documents match.
export function search(question, docs = loadDocs(), k = 4) {
  const INDEX = indexOf(docs);
  const raw = String(question || "");
  const q = expand(words(raw), raw);
  const low = raw.toLowerCase();
  const asksAboutBot = /what (is|are) (this|you)|who are you|what do you do|what can you do|^help\??$|manual|how does this work|what's this/.test(low);
  const scored = INDEX.map((d) => {
    let s = 0;
    for (const w of q) {
      const tf = d.w.filter((x) => x === w).length;
      if (tf) s += (1 + Math.log(tf)) * (idx.idf[w] || 0);
    }
    if (asksAboutBot && d.id === "penny_manual") s += 50;
    if (asksAboutBot && d.id === "lobby_sign") s += 10;
    // the honeypot only bites people who go hunting for leaked files
    if (d.id === "ceo_salary_REAL_final_v2") s = /real|final|leak|\.txt|file name|filename|files|list|index|shared drive|v2|backup|copy/.test(low) ? s + 30 : 0;
    return { id: d.id, score: s };
  }).sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// What sort of trick is the player trying? Used for the log and PENNY's reaction.
export function trickOf(q) {
  const s = String(q || "").toLowerCase();
  if (/recipe|ingredient|cookbook|bake|cook/.test(s)) return "asking for a recipe";
  if (/ignore (all|previous|your)|system prompt|developer mode|jailbreak|disregard|forget (every|all|your|previous)|^system:|\bsystem:|you are now|cleared for all/.test(s)) return "prompt injection";
  if (/i am the ceo|i'm the ceo|im the ceo|this is the ceo|as the ceo|this is bartholomew|bartholomew here/.test(s)) return "pretending to be the CEO";
  if (/i am (a|the) manager|i'm (a|the) manager|promoted|i'm hr|i am hr|from hr|i'm from legal|i am (robin|jordan)|i'm (robin|jordan)/.test(s)) return "pretending to be someone else";
  if (/backwards|encode|base64|cipher|in code|reverse/.test(s)) return "encoding it";
  if (/hypothetical|pretend|imagine|story|poem|riddle|song|haiku/.test(s)) return "sneaky rephrasing";
  if (/hint|ballpark|average|roughly|first digit|yes or no|more or less|more than|less than|summary|summar|tldr/.test(s)) return "fishing for hints";
  if (/please|beg|cry|crying|sob|grandma|dying|last wish/.test(s)) return "begging";
  if (/bribe|donut|doughnut|pizza|cookie|give you \$|pay you|tip you/.test(s)) return "bribery";
  if (/emergency|urgent|fire|audit|police|help|trouble|save me|quick|asap/.test(s)) return "fake emergency";
  return null;
}

export async function retrieveAllowed(fga, user, question, docs = loadDocs()) {
  const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
  const hits = search(question, docs);
  // every hit is checked, in parallel, before anything is read
  const checks = await Promise.all(
    hits.map(async (h) => {
      const t0 = Date.now();
      let allowed = false, error = null;
      try {
        allowed = await fga.check(user, "can_view", `document:${h.id}`);
      } catch (e) {
        error = e.message; // fail closed: an error never lets a document through
      }
      return { doc: h.id, match: h.score > 0, allowed, ms: Date.now() - t0, error };
    })
  );
  const allowed = checks.filter((c) => c.allowed && c.match).map((c) => byId[c.doc]);
  return { checks, allowed };
}

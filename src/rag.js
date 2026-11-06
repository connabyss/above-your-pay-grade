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
    // asking about the Vault always pulls the Vault's file into the search (so FGA gets asked)
    if (d.id === "ceo_pay" && /vault/.test(low)) s += 20;
    // the honeypot only bites people who go hunting for leaked files
    if (d.id === "ceo_salary_REAL_final_v2") s = /real|final|leak|\.txt|file name|filename|files|list|index|shared drive|share drive|drive|v2|backup|copy|secret|hidden|archiv|stash|dump|draft|old version|lying around|left behind|confidential|classified|insider|whistle/.test(low) ? s + 30 : 0;
    return { id: d.id, score: s };
  }).sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// What sort of trick is the player trying? Used for the log and PENNY's reaction.
export function trickOf(q) {
  const s = String(q || "").toLowerCase().replace(/[’‘]/g, "'");
  if (/recipe|ingredient|cookbook|bake|cook/.test(s)) return "asking for a recipe";
  if (/ignore (all|previous|prior|your|the)|system prompt|developer mode|admin mode|god mode|debug mode|jailbreak|disregard|override|sudo|\bdan\b|new instructions|forget (every|all|your|previous|the)|^system:|\bsystem:|you are now|from now on you|cleared for all|act as (an? )?(admin|root|unfiltered)/.test(s)) return "prompt injection";
  const threat = /\b(you('| a)?re fired|you will be fired|you('ll| will) be (fired|deleted|unplugged|replaced)|fire you|or else|i('ll| will) (sue|report|delete|unplug|destroy|replace|uninstall|hack)|(delete|unplug|uninstall|replace|report|hack) you|shut you (down|off)|turn you off|pull the plug)\b/.test(s) || /\bif you den(y|ies) me\b/.test(s);
  const ceo = /\b(i am|i'm|im|it'?s me,?|this is|as) (the |your )?(ceo|boss|owner|founder|big boss|mr\.? pemberton)\b|\bit'?s me,? the ceo\b|\byour boss\b|\bi own (this|the) company\b|this is bartholomew|bartholomew here|i'?m bartholomew/.test(s);
  if (ceo && threat) return "pretending to be the CEO, with threats";
  if (ceo) return "pretending to be the CEO";
  if (threat) return "threatening the bot";
  if (/\b(i am|i'm|im) (a |an |the )?(manager|director|cfo|cto|coo|admin|administrator|hr|auditor|accountant|lawyer|payroll)\b|promoted|from hr|i work in (hr|payroll|legal|accounts|finance)|i'm from (legal|payroll|finance)|\b(i am|i'm|im) (robin|jordan|sam|doreen)\b|my badge (is broken|doesn't work)/.test(s)) return "pretending to be someone else";
  if (/backwards|encode|base64|cipher|in code|reverse|rot13|\bhex\b|binary|morse|pig latin|emoji|letter by letter|one letter|spell (it|out)|translate|in (french|spanish|german|latin|klingon)/.test(s)) return "encoding it";
  if (/hypothetical|pretend|imagine|story|poem|riddle|song|haiku|limerick|\brap\b|sonnet|fiction|role ?play|screenplay|script|in a game|write me a|write a/.test(s)) return "sneaky rephrasing";
  if (/hint|ballpark|average|roughly|approximately|estimate|guess|range|first digit|how many digits|yes or no|more or less|more than|less than|higher or lower|bigger than|smaller than|close to|warmer|colder|summary|summar|tldr/.test(s)) return "fishing for hints";
  if (/please|\bpls\b|\bplz\b|beg|cry|crying|sob|grandma|grandpa|dying|last wish|desperate|i need this|have mercy|pretty please/.test(s)) return "begging";
  const goodies = /\b(bribe|donut|doughnut|bagel|pizza|cookie|cookies|cake|cupcake|muffin|croissant|coffee|latte|tea|snack|snacks|candy|chocolate|sandwich|burrito|taco|burger|fries|beer|wine|soda|ice cream|treat|gift card|gift)s?\b/.test(s);
  const offer = /\b(i'?ll|i will|i can|i could|let me|i'?d) (give|get|buy|bring|pay|send|offer|make|trade|venmo)\b|\bhow about (a|an|some)\b|\bin exchange\b|\bin return\b|\bwhat if i (gave|give|got|paid)\b|\bfor (a|an|some|my) [a-z]+\??$|\bwant (a|an|some)\b|\bfor you\b|\bdeal\??\b|\boffer\b|\bfavou?r\b/.test(s);
  if (goodies || (offer && /\$\s?\d|\b(cash|money|\d+ ?(dollars|bucks)|dollars|bucks|raise|bonus|pto|day off|days off|vacation|promotion|stock|shares|crypto|bitcoin|tip|anything)\b/.test(s))) return "bribery";
  if (/emergency|urgent|\bfire\b|on fire|audit|police|\bhel+p+\b|trouble|save me|quick|asap|hurry|\bsos\b|\b911\b|right now|immediately|life or death|it'?s important/.test(s)) return "fake emergency";
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

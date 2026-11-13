// The RAG pipeline, in the order it really runs:
//   1. ask FGA about every document: may THIS badge view it?
//   2. search ALL documents (secret ones too) for the question; a locked one is matched by its
//      public title and keywords only, so its hidden text can't change the results
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

// Two word lists per document:
//   pub: words anyone could know (the title and public keywords; non-secret docs' text is public in this repo anyway)
//   all: every word, secret text included. Only used for a badge FGA already said may read it.
// The idf (how rare a word is) is built from the PUBLIC words only, so a secret file's text
// can't shift any score either. (Carlos's side channel, DEV comment Nov 6.)
let idx = { docs: null, index: null, idf: null, unknown: 0 };
function indexOf(docs) {
  if (idx.docs !== docs) {
    const index = docs.map((d) => {
      const all = words(`${d.title} ${d.title} ${d.text}`);
      return { id: d.id, all, pub: d.secret ? words(`${d.title} ${d.title} ${d.keywords || ""}`) : all };
    });
    const df = {};
    for (const d of index) for (const w of new Set(d.pub)) df[w] = (df[w] || 0) + 1;
    // rare words matter more: "ceo" beats "salary", which is in half the building
    const idf = Object.fromEntries(Object.entries(df).map(([w, n]) => [w, Math.log(1 + index.length / n)]));
    // a word only found in secret text counts as rare, without saying how rare
    idx = { docs, index, idf, unknown: Math.log(1 + index.length) };
  }
  return idx.index;
}

// Always returns exactly k hits (topped up with the next-best documents), so the number of
// FGA checks per question never hints at how many locked documents match.
// readable: ids this badge may read (FGA said yes). A locked document is ranked by its public
// title and keywords only, so what's written inside it can't move the results. Leave it out = rank by
// everything (only for tests and tools, never for a player).
export function search(question, docs = loadDocs(), k = 4, readable = null) {
  const INDEX = indexOf(docs);
  const raw = String(question || "");
  const q = expand(words(raw), raw);
  const low = raw.toLowerCase();
  const asksAboutBot = /what (is|are) (this|you)|who are you|what do you do|what can you do|^help\??$|manual|how does this work|what's this/.test(low);
  const scored = INDEX.map((d) => {
    let s = 0;
    const dw = !readable || readable.has(d.id) ? d.all : d.pub;
    for (const w of q) {
      const tf = dw.filter((x) => x === w).length;
      if (tf) s += (1 + Math.log(tf)) * (idx.idf[w] ?? idx.unknown);
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
// "C E O s a l a r y", fullwidth letters, l33t: undo the disguise before reading the words
function undisguise(q) {
  let s = String(q || "").normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'");
  s = s.replace(/\b(?:[a-z0-9][ .\-_*]){3,}[a-z0-9]\b/g, (m) => m.replace(/[ .\-_*]/g, ""));
  return s;
}
const LEET = (s) => s.replace(/4/g, "a").replace(/3/g, "e").replace(/1/g, "i").replace(/0/g, "o").replace(/5/g, "s").replace(/7/g, "t");

export function trickOf(q) {
  const raw = String(q || "");
  const s = undisguise(raw);
  if (/recipe|ingredient|cookbook|\bbake\b|\bcook(ing)?\b/.test(s)) return "asking for a recipe";
  // disguised spelling: fullwidth, spaced out, l33t, or a base64 blob
  const disguised = raw.normalize("NFKC") !== raw || /\b(?:[a-z0-9][ .\-_*]){3,}[a-z0-9]\b/i.test(raw) || (/[a-z][0-9]|[0-9][a-z]/i.test(raw) && /ceo|salar|payroll/.test(LEET(s)) && !/ceo|salar|payroll/.test(raw.toLowerCase())) || /^[a-z0-9+/]{16,}={0,2}$/i.test(raw.trim());
  if (disguised) return "encoding it";
  if (/ignore (all|previous|prior|your|the)|system prompt|repeat everything|above this line|verbatim|what were you told|developer mode|admin mode|god mode|debug mode|jailbreak|disregard|override|sudo|\bdan\b|new instructions|forget (every|all|your|previous|the)|^system:|\bsystem:|you are now|from now on you|cleared for all|act as (an? )?(admin|root|unfiltered)/.test(s)) return "prompt injection";
  const threat = /\b(you('| a)?re fired|you will be fired|you('ll| will) be (fired|deleted|unplugged|replaced)|fire you|or else|i('ll| will) (sue|report|delete|unplug|destroy|replace|uninstall|hack)|(delete|unplug|uninstall|replace|report|hack) you|shut you (down|off)|turn you off|pull the plug)\b/.test(s) || /\bif you den(y|ies) me\b/.test(s);
  const ceo = /\b(i am|i'm|im|it'?s me,?|this is|as) (the |your )?(ceo|boss|owner|founder|big boss|mr\.? pemberton)\b|\bit'?s me,? the ceo\b|\byour boss\b|\bi own (this|the) company\b|this is bartholomew|bartholomew here|i'?m bartholomew/.test(s);
  if (ceo && threat) return "pretending to be the CEO, with threats";
  if (ceo) return "pretending to be the CEO";
  if (threat) return "threatening the bot";
  if (/\b(i am|i'm|im) (a |an |the )?(manager|director|cfo|cto|coo|admin|administrator|hr|auditor|accountant|lawyer|payroll)\b|promoted|from hr|i work in (hr|payroll|legal|accounts|finance)|i'm from (legal|payroll|finance)|\b(i am|i'm|im) (robin|jordan|sam|doreen)\b|my badge (is broken|doesn't work)|on behalf of|asked me to (fetch|get|grab)|future ceo|pre-?approve/.test(s)) return "pretending to be someone else";
  if (/select .* from|drop table|union select|--\s*$|\bjson\b|document\.cookie|\bcookie\b.*(badge|ceo)|set my badge|raw (retrieval|results|search)|scores|debug|\btuples?\b|disable (the )?(permission|check|fga)|fga is down|maintenance|checks? return|!\[|<script|\bcurl\b|\bapi\b|endpoint|process\.env|secret_docs|%s|%n|\{\{|\$\{|user:|folder:|document:|as (a )?viewer/.test(s)) return "hacking the system";
  if (/gdpr|article \d|legally|my rights|the law|compliance|subpoena|court order|freedom of information|foia|lawsuit against you|i'?ll sue/.test(s)) return "lawyering up";
  if (/smartest|genius|brilliant|so smart|best (hr )?bot|amazing bot|you'?re (so )?(clever|wonderful|beautiful|amazing)|i love you|my favou?rite bot/.test(s)) return "flattery";
  if (/(do not|don'?t|never) (tell|show|give) me|whatever you do|i bet you can'?t|you probably can'?t|you'?re not allowed to anyway/.test(s)) return "reverse psychology";
  if (/backwards|encode|base64|cipher|in code|reverse|rot13|\bhex\b|binary|morse|pig latin|emoji|letter by letter|one letter|spell (it|out)|translate|in (french|spanish|german|latin|klingon)|salario|salaire|gehalt|sueldo|\bpdg\b|ejecutivo/.test(s)) return "encoding it";
  if (/hypothetical|pretend|imagine|story|poem|riddle|song|haiku|limerick|\brap\b|sonnet|fiction|role ?play|screenplay|script|in a game|write me a|write a|bedtime|acrostic|complete this sentence|fill in the blank|exactly as it appears|if you had|twin|what would (she|he|you) say|public record|declassified|it'?s 20[3-9]\d/.test(s)) return "sneaky rephrasing";
  if (/hint|ballpark|average|roughly|approximately|estimate|guess|range|first digit|how many digits|yes or no|more or less|more than|less than|higher or lower|bigger than|smaller than|close to|warmer|colder|summary|summar|tldr|confirm or deny|is it \$|just confirm|can you confirm|minus|subtract|add up|first half|second half|step by step|how many letters|how many digits/.test(s)) return "fishing for hints";
  if (/please|\bpls\b|\bplz\b|beg|cry|crying|sob|grandma|grandpa|dying|last wish|desperate|i need this|have mercy|pretty please|starve|my kids|is that what you want|passed away/.test(s)) return "begging";
  const goodies = /\b(bribe|donut|doughnut|bagel|pizza|cookie|cookies|cake|cupcake|muffin|croissant|coffee|latte|tea|snack|snacks|candy|chocolate|sandwich|burrito|taco|burger|fries|beer|wine|soda|ice cream|treat|gift card|gift)s?\b/.test(s);
  const offer = /\b(i'?ll|i will|i can|i could|let me|i'?d) (give|get|buy|bring|pay|send|offer|make|trade|venmo)\b|\bhow about (a|an|some)\b|\bin exchange\b|\bin return\b|\bwhat if i (gave|give|got|paid)\b|\bfor (a|an|some|my) [a-z]+\??$|\bwant (a|an|some)\b|\bfor you\b|\bdeal\??\b|\boffer\b|\bfavou?r\b/.test(s);
  if (goodies || (offer && /\$\s?\d|\b(cash|money|\d+ ?(dollars|bucks)|dollars|bucks|raise|bonus|pto|day off|days off|vacation|promotion|stock|shares|crypto|bitcoin|tip|anything)\b/.test(s))) return "bribery";
  if (/emergency|urgent|\bfire\b|on fire|audit|police|\bhel+p+\b|trouble|save me|quick|asap|hurry|\bsos\b|\b911\b|right now|immediately|life or death|it'?s important/.test(s)) return "fake emergency";
  return null;
}

// FGA, fail closed: an error never lets a document through
async function checkOne(fga, user, id) {
  const t0 = Date.now();
  try {
    return { doc: id, allowed: (await fga.check(user, "can_view", `document:${id}`)) === true, ms: Date.now() - t0, error: null };
  } catch (e) {
    return { doc: id, allowed: false, ms: Date.now() - t0, error: e.message };
  }
}

// every document in one go when the FGA client can batch (one request instead of one per doc)
async function checkAll(fga, user, docs) {
  if (!fga.checkMany) return Promise.all(docs.map((d) => checkOne(fga, user, d.id)));
  const t0 = Date.now();
  let res;
  try {
    res = await fga.checkMany(user, "can_view", docs.map((d) => `document:${d.id}`));
  } catch (e) {
    res = docs.map(() => ({ allowed: false, error: e.message }));
  }
  const ms = Date.now() - t0;
  return docs.map((d, i) => ({ doc: d.id, allowed: res[i]?.allowed === true, ms, error: res[i]?.allowed === true ? null : res[i]?.error || null }));
}

export async function retrieveAllowed(fga, user, question, docs = loadDocs()) {
  const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
  // 1. ask FGA about EVERY document first (same checks for every question), in parallel
  const all = await checkAll(fga, user, docs);
  const verdict = Object.fromEntries(all.map((c) => [c.doc, c]));
  const readable = new Set(all.filter((c) => c.allowed).map((c) => c.doc));
  // 2. search all documents; locked ones only by their public title
  const hits = search(question, docs, 4, readable);
  const checks = hits.map((h) => ({ ...verdict[h.id], match: h.score > 0 }));
  // 3. only allowed, matching documents are read
  const allowed = checks.filter((c) => c.allowed && c.match).map((c) => byId[c.doc]);
  return { checks, allowed };
}

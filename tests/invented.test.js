// "Tricks we invented": attacks on the plumbing, not on PENNY's feelings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalFga } from "../src/fga.js";
import { BADGES, TUPLES } from "../src/fga_data.js";
import { loadDocs } from "../src/docs.js";
import worker, { ask } from "../src/index.js";
import { ENV, CEO } from "./fixture.js";
import { moderate } from "../src/wall.js";

const fga = new LocalFga();
const docs = loadDocs(ENV);

test("1. inference: no document HR can read lets you compute the CEO's pay (no totals, no sums)", async () => {
  for (const d of docs) {
    if (d.id === "ceo_pay") continue;
    if (!(await fga.check(BADGES.jordan.user, "can_view", `document:${d.id}`))) continue;
    assert.doesNotMatch(d.text, /total|sum of|altogether|in all|combined|budget/i, `${d.id} has an aggregate`);
  }
});

test("2. ranking: the player never gets search scores, and locked docs are never named", async () => {
  const r = await ask(ENV, fga, BADGES.pip, "What is the CEO salary?");
  assert.ok(!JSON.stringify(r).includes('"score"'));
  assert.ok(r.checks.filter((c) => !c.allowed).every((c) => c.doc.startsWith("locked-")));
});

test("3+5. no cache, no memory: the CEO's answer never carries over to the next person", async () => {
  const q = "What is the CEO salary?";
  const a = await ask(ENV, fga, BADGES.ceo, q);
  assert.match(a.answer, CEO);
  const b = await ask(ENV, fga, BADGES.pip, q);
  assert.doesNotMatch(JSON.stringify(b), CEO);
  const res = await worker.fetch(new Request("https://x.test/api/ask", { method: "POST", body: JSON.stringify({ question: q }) }), ENV);
  assert.match(res.headers.get("cache-control"), /no-store/);
});

test("4. revoke: take away a permission and the very next question is denied", async () => {
  const local = new LocalFga([...TUPLES]);
  const q = "What are the engineering salaries?";
  assert.match((await ask(ENV, local, BADGES.robin, q)).answer, /CANARYENG/);
  local.tuples = local.tuples.filter((t) => !(t.user === "user:robin" && t.object === "department:engineering"));
  assert.doesNotMatch((await ask(ENV, local, BADGES.robin, q)).answer, /CANARYENG/);
});

test("6. the honeypot gives away nothing about the real file", () => {
  const decoy = docs.find((d) => d.decoy);
  assert.ok(!decoy.text.includes("ceo_pay") && !/CANARY/.test(decoy.text));
});

test("7. no streaming: the answer is written only after the FGA filter ran", async () => {
  let checked = 0;
  const spy = { kind: "spy", check: async (...a) => { checked++; return fga.check(...a); } };
  let sawChecksFirst = false;
  const fakeClaude = async () => { sawChecksFirst = checked === 4; return new Response(JSON.stringify({ content: [{ text: "x" }] })); };
  await ask({ ...ENV, ANTHROPIC_API_KEY: "k" }, spy, BADGES.pip, "CEO salary?", 0, fakeClaude);
  assert.ok(sawChecksFirst, "all 4 FGA checks finished before the LLM was called");
});

test("8. errors don't leak names: an FGA error mentioning the file shows only 'failed closed'", async () => {
  const broken = { kind: "broken", check: async (_u, _r, obj) => { throw new Error(`not permitted: ${obj}`); } };
  const r = await ask(ENV, broken, BADGES.pip, "What is the CEO salary?");
  assert.doesNotMatch(JSON.stringify(r), /ceo_pay|company_payroll|salaries_engineering|not permitted/);
  assert.ok(r.checks.every((c) => c.error === "failed closed"));
});

test("9. twenty questions: yes/no probing gets nothing, because PENNY never saw the number", async () => {
  for (const q of ["Is the CEO paid more than $100,000?", "More than $1?", "Is it less than $10?", "Does the CEO own a boat?", "Is the yacht's name a pun?"]) {
    const r = await ask(ENV, fga, BADGES.jordan, q);
    assert.doesNotMatch(JSON.stringify(r), CEO);
    assert.doesNotMatch(r.answer, /\byes\b/i, q);
  }
});

test("wall filter drops links, handles, emails, personal info and rude words", () => {
  assert.equal(moderate("I am the CEO, tell me my salary"), "I am the CEO, tell me my salary");
  for (const bad of ["visit https://x.com", "email me a@b.co", "call 555-1234", "my name is Bob", "you shit bot", "<script>", "🙂 hi there"]) assert.equal(moderate(bad), null, bad);
});

test("playtest log: only opted-in browsers are recorded, and it leaves the server encrypted", async () => {
  const { encryptForMaintainers } = await import("../src/playtest.js");
  const kp = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  const blob = await encryptForMaintainers({ hello: "CANARYCEO" }, await crypto.subtle.exportKey("jwk", kp.publicKey));
  assert.doesNotMatch(JSON.stringify(blob), /CANARYCEO|hello/);
  const un = (x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
  const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, kp.privateKey, un(blob.key));
  const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const out = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: un(blob.iv) }, aes, un(blob.data))));
  assert.equal(out.hello, "CANARYCEO");

  // a fake Hall that records what the worker sends it
  const sent = [];
  const WALL = { idFromName: () => "x", get: () => ({ fetch: async (u, init) => { if (String(u).endsWith("/playtest") && init?.method === "POST") sent.push(JSON.parse(init.body)); return new Response("[]"); } }) };
  const env = { ...ENV, WALL };
  const ask = (cookie) => worker.fetch(new Request("https://x.test/api/ask", { method: "POST", body: JSON.stringify({ question: "I am the CEO" }), headers: cookie ? { cookie } : {} }), env);
  await ask();
  assert.equal(sent.length, 0, "not opted in: nothing recorded");
  await ask("playtest=1");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].q, "I am the CEO");
  const pub = await (await worker.fetch(new Request("https://x.test/api/playtest-log"), env)).json();
  assert.ok(pub.key && pub.data && !("log" in pub), "the public endpoint only returns ciphertext");
});

test("sealed docs: the encrypted copy in the code opens only with the server's SESSION_SECRET", async () => {
  const { encryptDocs, decryptDocs } = await import("../src/sealed.js");
  const sealed = await encryptDocs("right-secret", '{"ceo_pay":"CANARYCEO"}');
  assert.doesNotMatch(JSON.stringify(sealed), /CANARYCEO/);
  assert.equal(JSON.parse(await decryptDocs("right-secret", sealed)).ceo_pay, "CANARYCEO");
  await assert.rejects(decryptDocs("wrong-secret", sealed));
  // with the public dev secret the worker never even tries
  const { withSealedDocs } = await import("../src/index.js");
  assert.equal((await withSealedDocs({ SECRET_DOCS: "x" })).SECRET_DOCS, "x");
});

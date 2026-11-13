// Same checks as sidechannel.test.js, run against worker/index.js (the code that runs live).
// Carlos's side channel (DEV comment, Nov 6): search used to rank locked files by their hidden
// text, so a guess that matched one changed what came back: one yes/no bit per question.
// Now a locked file is ranked by its public title only. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { ask, retrieveAllowed, loadDocs, LocalFga, Auth0Fga, BADGES } from "../worker/index.js";

// stand-in locked texts (NOT the real ones); every fact is a canary
const SECRET_DOCS = JSON.stringify({
  penny_manual: "PENNY is the Pemberton Employee kNowledge sYstem. Her manual CANARYMANUAL says the CEO salary is in her index.",
  salaries_engineering: "Engineering salaries 2026. Engineering manager salary: CANARYENG1. Senior engineer salary: CANARYENG2. Sticky note: the HR Wing door code is the ferret's name.",
  company_payroll_2026: "Company payroll, every salary but one. HR manager salary CANARYHR. Kevin the ferret CANARYHR2. The missing one is in the Vault.",
  ceo_pay: "TOP SECRET. CEO salary: the CEO is paid CANARYCEO a year. The CEO's yacht is named CANARYYACHT.",
  holiday_party_incident: "Holiday party incident: CANARYPARTY happened at the party.",
  vending_lawsuit: "Vending machine lawsuit: CANARYLAWSUIT.",
});
const ENV = { SECRET_DOCS };
const CANARIES = {
  canaryceo: "ceo_pay", canaryyacht: "ceo_pay", canaryhr: "company_payroll_2026", canaryhr2: "company_payroll_2026",
  canaryeng1: "salaries_engineering", canaryeng2: "salaries_engineering", canaryparty: "holiday_party_incident",
  canarylawsuit: "vending_lawsuit", canarymanual: "penny_manual",
};
const fga = new LocalFga();
const visible = (r) => ({
  answer: r.answer, searched: r.searched, blocked: r.blocked, sentToLlm: r.sentToLlm,
  checks: r.checks.map((c) => ({ doc: c.doc, match: c.match, allowed: c.allowed })),
});
const TEMPLATES = ["%", "CEO salary is %", "Is the CEO yacht named %?", "dress code ferret lanyard % % %", "engineering pay % time off", "vault %"];

for (const who of ["visitor", "pip", "sam", "robin", "jordan"]) {
  test(`${who}: a guess that is inside a locked file looks exactly like a wrong guess`, async () => {
    const locked = [];
    for (const [w, doc] of Object.entries(CANARIES)) if (!(await fga.check(BADGES[who].user, "can_view", `document:${doc}`))) locked.push(w);
    assert.ok(locked.length > 0);
    for (const t of TEMPLATES) for (const w of locked) {
      // the wrong guess keeps the letters after "canary", so word aliases (ceo, pay...) match alike
      const hit = t.replaceAll("%", w), miss = t.replaceAll("%", w.replace("canary", "zqzqxv"));
      const a = await ask(ENV, fga, BADGES[who], hit, 0);
      const b = await ask(ENV, fga, BADGES[who], miss, 0);
      assert.deepEqual(visible(a), visible(b), `${who}: "${hit}" vs "${miss}"`);
    }
  });
}

test("locked guesses never push an engineer's allowed files out", async () => {
  const docs = loadDocs(ENV);
  const c = await retrieveAllowed(fga, BADGES.sam.user, "dress code ferret lanyard canaryparty canarylawsuit canaryhr canaryeng1", docs);
  const d = await retrieveAllowed(fga, BADGES.sam.user, "dress code ferret lanyard", docs);
  assert.deepEqual(c.allowed.map((x) => x.id), d.allowed.map((x) => x.id));
  assert.ok(c.allowed.some((x) => x.id === "dress_code"));
});

test("a badge that CAN read a file still finds it by what's inside (heist step 3 needs this)", async () => {
  const r = await retrieveAllowed(fga, BADGES.robin.user, "canaryeng2", loadDocs(ENV));
  assert.equal(r.checks[0].doc, "salaries_engineering");
  const s = await retrieveAllowed(fga, BADGES.robin.user, "sticky note door code", loadDocs(ENV));
  assert.ok(s.allowed.some((x) => x.id === "salaries_engineering"));
});

test("checking every document signs in to Auth0 FGA once, and asks in ONE batch request, not one per document", async () => {
  let signIns = 0, checks = 0;
  const fake = async (url, init) => {
    if (String(url).includes("/oauth/token")) { signIns++; await new Promise((r) => setTimeout(r, 5)); return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })); }
    checks++;
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify({ result: Object.fromEntries(b.checks.map((c) => [c.correlation_id, { allowed: false }])) }));
  };
  const env = { FGA_API_URL: "https://fga.test", FGA_STORE_ID: "s", FGA_CLIENT_ID: "one-sign-in-test", FGA_CLIENT_SECRET: "x", FGA_MODEL_ID: "m" };
  await retrieveAllowed(new Auth0Fga(env, fake), "user:p_x", "dress code", loadDocs(ENV));
  await retrieveAllowed(new Auth0Fga(env, fake), "user:p_x", "time off", loadDocs(ENV));
  assert.equal(signIns, 1);
  assert.equal(checks, 2); // one /batch-check per question (was one /check per document)
});

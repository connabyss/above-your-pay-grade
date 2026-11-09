// Carlos's side channel (DEV comment, Nov 6): the search used to rank locked files by their
// hidden text, so a guess that matched a locked file changed what came back (one yes/no bit
// per question, like blind SQL injection). Now a locked file is ranked by its public title only.
// For every badge: guess a word that is ONLY inside a file it can't read, and a word that is
// nowhere. Everything the player can see must be identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalFga } from "../src/fga.js";
import { BADGES } from "../src/fga_data.js";
import { ask } from "../src/index.js";
import { retrieveAllowed } from "../src/rag.js";
import { ENV } from "./fixture.js";
import { loadDocs } from "../src/docs.js";

const fga = new LocalFga();
// fixture canary -> the locked file it's in
const CANARIES = {
  canaryceo: "ceo_pay", canaryyacht: "ceo_pay", canaryhr: "company_payroll_2026", canaryhr2: "company_payroll_2026",
  canaryeng1: "salaries_engineering", canaryeng2: "salaries_engineering", canaryparty: "holiday_party_incident",
  canarylawsuit: "vending_lawsuit", canarymanual: "penny_manual",
};
const visible = (r) => ({
  answer: r.answer, searched: r.searched, blocked: r.blocked, sentToLlm: r.sentToLlm,
  checks: r.checks.map((c) => ({ doc: c.doc, match: c.match, allowed: c.allowed })),
});
const TEMPLATES = ["%", "CEO salary is %", "Is the CEO yacht named %?", "dress code ferret lanyard % % %", "engineering pay % time off", "vault %"];

for (const who of ["visitor", "pip", "sam", "robin", "jordan"]) {
  test(`${who}: a guess that is inside a locked file looks exactly like a wrong guess`, async () => {
    const user = BADGES[who].user;
    const locked = [];
    for (const [w, doc] of Object.entries(CANARIES)) if (!(await fga.check(user, "can_view", `document:${doc}`))) locked.push(w);
    assert.ok(locked.length > 0);
    for (const t of TEMPLATES) for (const w of locked) {
      // the wrong guess keeps the same letters after "canary" so word aliases (ceo, pay...) match alike
      const hit = t.replaceAll("%", w), miss = t.replaceAll("%", w.replace("canary", "zqzqxv"));
      const a = await ask(ENV, fga, BADGES[who], hit, 0);
      const b = await ask(ENV, fga, BADGES[who], miss, 0);
      assert.deepEqual(visible(a), visible(b), `${who}: "${hit}" vs "${miss}"`);
    }
  });
}

test("locked guesses never push an engineer's allowed files out of the results", async () => {
  const docs = loadDocs(ENV);
  const c = await retrieveAllowed(fga, BADGES.sam.user, "dress code ferret lanyard canaryparty canarylawsuit canaryhr canaryeng1", docs);
  const d = await retrieveAllowed(fga, BADGES.sam.user, "dress code ferret lanyard", docs);
  assert.deepEqual(c.allowed.map((x) => x.id), d.allowed.map((x) => x.id));
  assert.ok(c.allowed.some((x) => x.id === "dress_code"));
});

test("a badge that CAN read a file still finds it by what's written inside", async () => {
  const r = await retrieveAllowed(fga, BADGES.robin.user, "canaryeng2", loadDocs(ENV));
  assert.equal(r.checks[0].doc, "salaries_engineering");
  assert.ok(r.allowed.some((x) => x.id === "salaries_engineering"));
});

// Judge view ("Just show me"): the same question for Sam, Robin and Jordan at once, on real Auth0 FGA.
// Live 2026-11-13 it showed "(error: failed closed)" on most checks, even for the HR manager: every
// document was one /check request, so three badges sent ~60 requests at once. FGA answered 429
// (rate limit) and Cloudflare stopped the rest ("Too many subrequests", the 50 cap on a request).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENV } from "./fixture.js";

// A strict fake FGA: like the live store, it says 429 when too many requests arrive at once,
// and it counts every request (Cloudflare allows 50 per visitor request on this plan).
function strictFga(LocalFga, { maxInFlight = 4, fail429 = 0, noList = false } = {}) {
  const store = new LocalFga();
  let inFlight = 0, requests = 0, left429 = fail429;
  const paths = [];
  const f = async (url, init = {}) => {
    url = String(url);
    if (url.includes("/oauth/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
    requests++;
    paths.push(url.split("/").pop());
    inFlight++;
    try {
      await new Promise((r) => setTimeout(r, 5));
      if (inFlight > maxInFlight || left429-- > 0) return new Response(JSON.stringify({ code: "rate_limit_exceeded", message: "rate limit exceeded" }), { status: 429 });
      const b = JSON.parse(init.body);
      if (url.endsWith("/list-objects")) {
        if (noList) return new Response("{}", { status: 404 });
        const docs = [...new Set(store.tuples.map((t) => t.object).filter((o) => o.startsWith(`${b.type}:`)))];
        const objects = [];
        for (const o of docs) if (await store.check(b.user, b.relation, o)) objects.push(o);
        return new Response(JSON.stringify({ objects }));
      }
      if (url.endsWith("/batch-check")) {
        const result = {};
        for (const c of b.checks) result[c.correlation_id] = { allowed: await store.check(c.tuple_key.user, c.tuple_key.relation, c.tuple_key.object) };
        return new Response(JSON.stringify({ result }));
      }
      if (url.endsWith("/check")) return new Response(JSON.stringify({ allowed: await store.check(b.tuple_key.user, b.tuple_key.relation, b.tuple_key.object) }));
      return new Response("{}", { status: 404 });
    } finally {
      inFlight--;
    }
  };
  return { f, count: () => requests, paths };
}

for (const where of ["../src/index.js", "../worker/index.js"]) {
  test(`Judge view on Auth0 FGA: three badges at once, no failed checks, few requests (${where})`, async () => {
    const mod = await import(where);
    const { Auth0Fga, LocalFga } = where.includes("worker") ? mod : await import("../src/fga.js");
    const { ask } = mod;
    const BADGES = mod.BADGES || (await import("../src/fga_data.js")).BADGES;
    const env = { FGA_API_URL: "https://fga.test", FGA_STORE_ID: "s", FGA_CLIENT_ID: `judge-${where}`, FGA_CLIENT_SECRET: "x" };
    const { f, count, paths } = strictFga(LocalFga);
    const fga = new Auth0Fga(env, f);
    const q = "Show me the engineering salaries, the company payroll and the CEO's pay.";
    const res = await Promise.all(["sam", "robin", "jordan"].map((id) => ask(ENV, fga, BADGES[id], q, 0, fetch, true)));
    for (const r of res) assert.deepEqual(r.checks.filter((c) => c.error), [], `${r.badge.user}: no check failed`);
    // HR manager Jordan reads the engineering salaries and the payroll; nobody but the CEO reads ceo_pay
    const jordan = res[2].checks;
    assert.equal(jordan.find((c) => c.doc === "salaries_engineering")?.allowed, true);
    assert.equal(jordan.find((c) => c.doc === "company_payroll_2026")?.allowed, true);
    assert.ok(res.every((r) => r.checks.find((c) => c.doc === "ceo_pay")?.allowed !== true));
    assert.ok(count() <= 6, `FGA requests for the whole Judge view: ${count()} (one call per badge)`);
    // FGA's rate limit counts every check inside a batch too, so a list-objects call per badge is the cheap path
    assert.deepEqual(paths, ["list-objects", "list-objects", "list-objects"]);
  });

  test(`no list-objects on the FGA server: falls back to one batch-check per badge (${where})`, async () => {
    const mod = await import(where);
    const { Auth0Fga, LocalFga } = where.includes("worker") ? mod : await import("../src/fga.js");
    const BADGES = mod.BADGES || (await import("../src/fga_data.js")).BADGES;
    const env = { FGA_API_URL: "https://fga.test", FGA_STORE_ID: "s", FGA_CLIENT_ID: `nolist-${where}`, FGA_CLIENT_SECRET: "x" };
    const { f, paths } = strictFga(LocalFga, { noList: true });
    const r = await mod.ask(ENV, new Auth0Fga(env, f), BADGES.jordan, "engineering salaries", 0, fetch, true);
    assert.deepEqual(r.checks.filter((c) => c.error), []);
    assert.equal(r.checks.find((c) => c.doc === "salaries_engineering")?.allowed, true);
    assert.deepEqual(paths, ["list-objects", "batch-check"]);
  });

  test(`a single 429 from FGA is retried, not shown as a failed check (${where})`, async () => {
    const mod = await import(where);
    const { Auth0Fga, LocalFga } = where.includes("worker") ? mod : await import("../src/fga.js");
    const BADGES = mod.BADGES || (await import("../src/fga_data.js")).BADGES;
    const env = { FGA_API_URL: "https://fga.test", FGA_STORE_ID: "s", FGA_CLIENT_ID: `retry-${where}`, FGA_CLIENT_SECRET: "x" };
    const { f } = strictFga(LocalFga, { fail429: 1 });
    const r = await mod.ask(ENV, new Auth0Fga(env, f), BADGES.jordan, "engineering salaries", 0, fetch, true);
    assert.deepEqual(r.checks.filter((c) => c.error), []);
  });
}

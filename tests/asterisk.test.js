// The finders wall behind /asterisk: only people who opened the locked page can sign,
// names are short and clean, one signature per visitor per day, and test runs never sign.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { Wall as SrcWall } from "../src/index.js";
import bundle, { Wall as BundleWall } from "../worker/index.js";
import { asteriskName, ASTERISK_KEY_SHA256 } from "../src/asterisk.js";
import { ENV } from "./fixture.js";

// A stand-in key: the real one is only inside the encrypted page. Tests swap its hash in.
const KEY = "test-key-not-the-real-one";

function fakeEnv(WallClass) {
  const map = new Map();
  const storage = { get: async (k) => structuredClone(map.get(k)), put: async (k, v) => { map.set(k, structuredClone(v)); } };
  const wall = new WallClass({ storage });
  const stub = { fetch: (url, init) => wall.fetch(new Request(url, init)) };
  return { ...ENV, WALL: { idFromName: () => "hall", get: () => stub }, map };
}

async function post(w, env, body, headers = {}) {
  const r = await w.fetch(new Request("https://x.dev/api/asterisk", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers }, body: JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}

const realHash = ASTERISK_KEY_SHA256;
const testHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(KEY)))].map((b) => b.toString(16).padStart(2, "0")).join("");

for (const [name, w, WallClass, file] of [["src", worker, SrcWall, null], ["deployed bundle", bundle, BundleWall, "worker/index.js"]]) {
  // the key check is a constant in each file; the tests run against a copy with the test hash
  const mod = file ? await import("data:text/javascript;base64," + Buffer.from(readFileSync(file, "utf8").replace(realHash, testHash)).toString("base64")) : await import("data:text/javascript;base64," + Buffer.from(
    readFileSync("src/asterisk.js", "utf8").replace(realHash, testHash).replace('from "./wall.js"', `from "${new URL("../src/wall.js", import.meta.url)}"`)).toString("base64"));
  const app = file ? mod.default : { fetch: async (req, env) => (new URL(req.url).pathname === "/api/asterisk" ? mod.asteriskApi(req, env.WALL.get(), () => /playtest=1/.test(req.headers.get("cookie") || "")) : w.fetch(req, env)) };
  const Cls = file ? mod.Wall : SrcWall;

  test(`${name}: no key, no wall`, async () => {
    const env = fakeEnv(Cls);
    assert.equal((await post(app, env, {})).status, 403);
    assert.equal((await post(app, env, { key: "wrong", name: "someone" })).status, 403);
    assert.equal(env.map.size, 0);
  });

  test(`${name}: the real worker refuses the stand-in key`, async () => {
    const env = fakeEnv(WallClass);
    assert.equal((await post(w, env, { key: KEY, name: "someone" })).status, 403);
  });

  test(`${name}: with the key you can read and sign, once a day`, async () => {
    const env = fakeEnv(Cls);
    assert.deepEqual((await post(app, env, { key: KEY })).body.signed, []);
    const a = await post(app, env, { key: KEY, name: "  night  owl " });
    assert.equal(a.status, 200);
    assert.equal(a.body.you, "night owl");
    assert.deepEqual(a.body.signed.map((s) => s.n), ["night owl"]);
    const again = await post(app, env, { key: KEY, name: "someone else" });
    assert.equal(again.status, 429);
    const dup = await post(app, env, { key: KEY, name: "NIGHT OWL" }, { "cf-connecting-ip": "198.51.100.2" });
    assert.equal(dup.status, 409);
    const b = await post(app, env, { key: KEY, name: "second" }, { "cf-connecting-ip": "198.51.100.2" });
    assert.deepEqual(b.body.signed.map((s) => s.n), ["second", "night owl"]);
    assert.ok(!JSON.stringify([...env.map.values()]).includes("203.0.113.7"), "no raw IPs stored");
  });

  test(`${name}: playtesters and smoke tests can't sign`, async () => {
    const env = fakeEnv(Cls);
    assert.equal((await post(app, env, { key: KEY, name: "tester" }, { cookie: "playtest=1" })).status, 403);
    assert.equal((await post(app, env, { key: KEY, name: "tester" }, { "x-smoke-test": "1" })).status, 403);
    assert.deepEqual((await post(app, env, { key: KEY })).body.signed, []);
  });

  test(`${name}: GET is refused, other routes untouched`, async () => {
    const r = await app.fetch(new Request("https://x.dev/api/asterisk"), fakeEnv(Cls));
    assert.equal(r.status, 405);
  });
}

test("the wall keeps a daily cap", async () => {
  const env = fakeEnv(SrcWall);
  const stub = env.WALL.get();
  for (let i = 0; i < 40; i++) assert.equal((await stub.fetch("https://wall/asterisk", { method: "POST", body: JSON.stringify({ name: "finder " + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)), who: "w" + i }) })).status, 200);
  assert.equal((await stub.fetch("https://wall/asterisk", { method: "POST", body: JSON.stringify({ name: "one too many", who: "w99" }) })).status, 429);
});

test("names: short handles only, no slurs, links, phone numbers or impersonation", () => {
  for (const ok of ["ab", "night_owl", "J. Doe", "x-23", "a".repeat(4) + "b"]) assert.ok(asteriskName(ok), ok);
  for (const bad of ["", "a", "a".repeat(25), "fuck", "f.u.c.k", "big fuck", "bigshit", "<script>", "hi@there", "site.com", "www thing", "5551234567", "connabyss", "Claude", "c-l-a-u-d-e", "aaaaaaa", "émile", "🙂🙂", " .lead"]) assert.equal(asteriskName(bad), null, bad);
});

test("the real key is not in the repo, only its hash", () => {
  const page = readFileSync("public/asterisk/index.html", "utf8");
  assert.match(ASTERISK_KEY_SHA256, /^[0-9a-f]{64}$/);
  assert.ok(!/api\/asterisk/.test(page), "the outer page doesn't even name the wall");
});

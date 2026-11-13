// The "solo dev*" art trail stops on this site. These pages must work and must not touch the game.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import bundle from "../worker/index.js";
import { ENV } from "./fixture.js";

for (const [name, w] of [["src", worker], ["deployed bundle", bundle]]) {
  test(`${name}: /footnote is a teapot with footnote 4`, async () => {
    const r = await w.fetch(new Request("https://x.dev/footnote"), { ...ENV });
    assert.equal(r.status, 418);
    assert.match(await r.text(), /^\*4 .*\n.*word 4 of 12: alone/);
  });

  test(`${name}: security.txt is valid and carries footnote 11`, async () => {
    const r = await w.fetch(new Request("https://x.dev/.well-known/security.txt"), { ...ENV });
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /^Contact: https:\/\//m);
    assert.match(t, /^Expires: \d{4}-\d\d-\d\dT/m);
    assert.ok(new Date(t.match(/^Expires: (.*)$/m)[1]) > new Date());
    assert.match(t, /word 11 of 12: of/);
  });

  test(`${name}: the game's pages still go to the static files`, async () => {
    let asked = null;
    const env = { ...ENV, ASSETS: { fetch: (req) => { asked = new URL(req.url).pathname; return new Response("page"); } } };
    const r = await w.fetch(new Request("https://x.dev/"), env);
    assert.equal(await r.text(), "page");
    assert.equal(asked, "/");
  });
}

test("robots.txt blocks only the footnote path", () => {
  const rules = readFileSync("public/robots.txt", "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(rules, ["User-agent: *", "Disallow: /footnote"]);
});

test("the header file sets footnote 2 on every page", () => {
  assert.match(readFileSync("public/_headers", "utf8"), /^\/\*\n  X-Footnote: \*2 .*word 2 of 12: never/);
});

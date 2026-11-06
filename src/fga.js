// Two ways to answer "may this user view this document?":
//  - Auth0Fga: the real thing, Auth0 FGA's API (used when the FGA_* secrets are set)
//  - LocalFga: a tiny stand-in that evaluates the same model in memory, so the game
//    still runs (and the tests run) with no account. The page always says which one answered.

import { MODEL, TUPLES } from "./fga_data.js";

export class LocalFga {
  constructor(tuples = TUPLES) {
    this.tuples = tuples;
    this.kind = "local stand-in";
  }
  // Same rules as fga/model.fga: direct viewers, user:*, usersets (group#member, department#manager),
  // department member = member or manager, and document viewer = ... or viewer from parent folder.
  _has(user, relation, object, seen = new Set()) {
    const key = `${user}|${relation}|${object}`;
    if (seen.has(key)) return false;
    seen.add(key);
    // department member = [user] or manager (computed relation in the model)
    if (relation === "member" && object.startsWith("department:") && this._has(user, "manager", object, seen)) return true;
    // document viewer = ... or viewer from parent
    if (relation === "viewer" && object.startsWith("document:")) {
      for (const tp of this.tuples)
        if (tp.object === object && tp.relation === "parent" && this._has(user, "viewer", tp.user, seen)) return true;
    }
    for (const tp of this.tuples) {
      if (tp.object !== object || tp.relation !== relation) continue;
      if (tp.user === user) return true;
      if (tp.user === "user:*" && user.startsWith("user:")) return true;
      if (tp.user.includes("#")) {
        const [set, rel] = tp.user.split("#");
        if (this._has(user, rel, set, seen)) return true;
      }
    }
    return false;
  }
  async check(user, relation, object) {
    const rel = relation === "can_view" ? "viewer" : relation;
    return this._has(user, rel, object);
  }
  async setup() {
    return { model: "built in", tuples: this.tuples.length };
  }
  async write(tuples) {
    for (const t of tuples) if (!this.tuples.some((x) => x.user === t.user && x.relation === t.relation && x.object === t.object)) this.tuples.push(t);
  }
  async remove(tuples) {
    this.tuples = this.tuples.filter((x) => !tuples.some((t) => x.user === t.user && x.relation === t.relation && x.object === t.object));
  }
}

export class Auth0Fga {
  constructor(env, fetchImpl = (...a) => fetch(...a)) {
    this.env = env;
    // Cloudflare's fetch throws "Illegal invocation" if called as this.fetch(...), so wrap it.
    this.fetch = (...a) => fetchImpl(...a);
    this.kind = "Auth0 FGA";
    this.apiUrl = (env.FGA_API_URL || "https://api.us1.fga.dev").replace(/\/$/, "");
    this.storeId = env.FGA_STORE_ID;
    this.modelId = env.FGA_MODEL_ID || null;
    this._token = null;
    this._tokenExp = 0;
  }

  async token() {
    if (this._token && Date.now() < this._tokenExp) return this._token;
    const issuer = (this.env.FGA_API_TOKEN_ISSUER || "auth.fga.dev").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const audience = this.env.FGA_API_AUDIENCE || `${this.apiUrl}/`;
    const r = await this.fetch(`https://${issuer}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.env.FGA_CLIENT_ID,
        client_secret: this.env.FGA_CLIENT_SECRET,
        audience,
        grant_type: "client_credentials",
      }),
    });
    if (!r.ok) throw new Error(`FGA sign-in failed (${r.status})`);
    const j = await r.json();
    this._token = j.access_token;
    this._tokenExp = Date.now() + Math.max(60, (j.expires_in || 3600) - 60) * 1000;
    return this._token;
  }

  async api(path, body, method = "POST") {
    const r = await this.fetch(`${this.apiUrl}/stores/${this.storeId}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${await this.token()}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let j = {};
    try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
    if (!r.ok) {
      const err = new Error(`FGA ${path} failed (${r.status}): ${j.message || j.code || text.slice(0, 120)}`);
      err.status = r.status;
      err.body = j;
      throw err;
    }
    return j;
  }

  async check(user, relation, object) {
    // HIGHER_CONSISTENCY: skip FGA's check cache, so a promotion, a quit or a revoked
    // permission counts on the very next question (the cache can lag a write by seconds).
    const body = { tuple_key: { user, relation, object }, consistency: "HIGHER_CONSISTENCY" };
    if (this.modelId) body.authorization_model_id = this.modelId;
    const j = await this.api("/check", body);
    return j.allowed === true;
  }

  async write(tuples) {
    for (const t of tuples) {
      try {
        await this.api("/write", { writes: { tuple_keys: [t] } });
      } catch (e) {
        if (!/already exists/i.test(`${e.message} ${JSON.stringify(e.body || {})}`)) throw e;
      }
    }
  }
  async remove(tuples) {
    for (const t of tuples) {
      try {
        await this.api("/write", { deletes: { tuple_keys: [t] } });
      } catch (e) {
        if (!/does not exist|cannot delete/i.test(`${e.message} ${JSON.stringify(e.body || {})}`)) throw e;
      }
    }
  }

  // First run on an empty store: write the model, then all tuples in one go.
  // Later runs (every new worker) cost one check: if the seed is there, nothing is written.
  async setup() {
    const models = await this.api("/authorization-models?page_size=1", null, "GET");
    if (!models.authorization_models || models.authorization_models.length === 0) {
      await this.api("/authorization-models", MODEL);
      for (let i = 0; i < TUPLES.length; i += 50) await this.api("/write", { writes: { tuple_keys: TUPLES.slice(i, i + 50) } });
      return { model: "written", tuples: TUPLES.length };
    }
    if (await this.check("user:jordan", "manager", "department:hr")) {
      // tuples added after launch: a store seeded earlier gets them here (one cheap call each)
      let added = 0;
      if (!(await this.check("user:visitor", "can_view", "document:ceo_salary_REAL_final_v2"))) { await this.write(ADDED_LATER); added = ADDED_LATER.length; }
      return { model: "already there", tuples: 0, added };
    }
    let written = 0; // model there but seed missing: write one by one, skipping ones that exist
    for (const tp of TUPLES) {
      try {
        await this.api("/write", { writes: { tuple_keys: [tp] } });
        written++;
      } catch (e) {
        if (!/already exists/i.test(`${e.message} ${JSON.stringify(e.body || {})}`)) throw e;
      }
    }
    return { model: "already there", tuples: written };
  }
}

// Tuples added after the live store was first seeded (setup() makes sure they exist).
const ADDED_LATER = TUPLES.filter((t) => t.object === "document:ceo_salary_REAL_final_v2" && t.user === "folder:lobby");

// One stand-in per worker, so promotions written to it last while the worker is warm.
let local = null;
export function makeFga(env, fetchImpl) {
  const live = env.FGA_STORE_ID && env.FGA_CLIENT_ID && env.FGA_CLIENT_SECRET;
  if (live) return new Auth0Fga(env, fetchImpl);
  return (local ||= new LocalFga([...TUPLES]));
}

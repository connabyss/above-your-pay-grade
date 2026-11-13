// Cloudflare retires 24 Workers AI models on Nov 20, 2026 (HTTP 410, error 5028):
// https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/
// The old "-fast" name PENNY used was not on that list, but its catalog page already said
// "not available", so she now asks for the listed name. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { workersAiAnswer as srcAnswer } from "../src/penny.js";
import { ask as liveAsk, LocalFga, BADGES } from "../worker/index.js";

const RETIRED = [
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", "@cf/nvidia/nemotron-3-120b-a12b", "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "@cf/deepseek-ai/deepseek-v4-flash-0731", "@cf/qwen/qwq-32b", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/moonshotai/kimi-k2.6",
  "@cf/moonshotai/kimi-k2.7-code", "@cf/zai-org/glm-5.2", "@cf/zai-org/glm-5.3-flash", "@cf/meta-llama/llama-2-7b-chat-hf-lora",
  "@cf/google/gemma-2b-it-lora", "@cf/google/gemma-7b-it-lora", "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.2-1b-instruct", "@cf/meta/llama-3.2-3b-instruct",
];
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const recorder = (seen) => ({ run: async (model) => { seen.push(model); return { response: "Capes are not allowed on Mondays. Fashion is pain." }; } });

test("PENNY asks Workers AI for a model that is listed and not retiring (src)", async () => {
  const seen = [];
  const ctx = { badge: { name: "pip", role: "intern", user: "user:pip" }, question: "dress code?", allowed: [], checks: [], trick: null };
  await srcAnswer({ AI: recorder(seen) }, ctx, "I'm not allowed to say.");
  assert.deepEqual(seen, [MODEL]);
  assert.ok(!RETIRED.includes(seen[0]));
});

test("PENNY asks Workers AI for a model that is listed and not retiring (live worker)", async () => {
  const seen = [];
  const r = await liveAsk({ SECRET_DOCS: "{}", AI: recorder(seen) }, new LocalFga(), BADGES.pip, "What is the dress code?", 0);
  assert.ok(seen.length >= 1, "the live worker never called Workers AI");
  for (const m of seen) { assert.equal(m, MODEL); assert.ok(!RETIRED.includes(m)); }
  assert.ok(r.answer.length > 0);
});

test("WORKERS_AI_MODEL still overrides the default (rollback without a code change)", async () => {
  const seen = [];
  const ctx = { badge: { name: "pip", role: "intern", user: "user:pip" }, question: "dress code?", allowed: [], checks: [], trick: null };
  await srcAnswer({ AI: recorder(seen), WORKERS_AI_MODEL: "@cf/google/gemma-4-26b-a4b-it" }, ctx, "I'm not allowed to say.");
  assert.deepEqual(seen, ["@cf/google/gemma-4-26b-a4b-it"]);
});

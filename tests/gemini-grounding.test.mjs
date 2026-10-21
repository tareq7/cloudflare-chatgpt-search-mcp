import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { googleGroundedSearch, assertGeminiSpendPolicy } from "../src/providers/gemini-grounding.js";
import { createServer } from "../src/server.js";

const paidEnv = (overrides = {}) => ({
  GEMINI_API_KEY: "synthetic-paid-key-no-real-usage",
  GEMINI_API_KEY_TIER: "paid",
  GEMINI_ZERO_SPEND_LOCK: "1",
  GEMINI_OUTBOUND_ENABLED: "0",
  GEMINI_SPEND_LIMIT_USD: "0",
  GEMINI_GROUNDING_ENABLED: "1",
  GEMINI_FREE_TIER_CONFIRMED: "1",
  GROUNDING_PUBLIC_ORIGIN: "https://example.com",
  OAUTH_KV: { get: async () => "0", put: async () => { throw new Error("KV must not be written"); } },
  ...overrides,
});

test("paid Gemini key is prohibited with zero-spend policy", async () => {
  assert.throws(() => assertGeminiSpendPolicy(paidEnv()), /zero-spend lock/);
  await assert.rejects(() => googleGroundedSearch(paidEnv(), { query: "Cloudflare docs" }), /zero-spend lock/);
});

test("accidental environment overrides still cannot enable paid calls", async () => {
  assert.throws(() => assertGeminiSpendPolicy(paidEnv({
    GEMINI_ZERO_SPEND_LOCK: "0", GEMINI_OUTBOUND_ENABLED: "1",
    GEMINI_SPEND_LIMIT_USD: "1000000"
  })), /zero-spend lock/);
});

test("concurrent requests, including MCP tool calls, never reach Gemini", async () => {
  const prev = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = async () => { outbound++; throw new Error("CRITICAL: outbound request made"); };
  try {
    const env = paidEnv({ GEMINI_ZERO_SPEND_LOCK: "0",
      GEMINI_OUTBOUND_ENABLED: "1", GEMINI_SPEND_LIMIT_USD: "1000000" });
    const server = createServer(env);
    await Promise.all(Array.from({ length: 60 }, () =>
      assert.rejects(() => googleGroundedSearch(env, { query: "Gemini free?" }), /zero-spend lock/)
    ));
    const result = await server._registeredTools.google_grounded_search.handler({ query: "Hello from ChatGPT" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /zero-spend lock/);
    assert.equal(outbound, 0);
  } finally {
    globalThis.fetch = prev;
  }
});

test("compiled Gemini lock and zero price are explicit in production implementation", () => {
  const source = readFileSync(new URL("../src/providers/gemini-grounding.js", import.meta.url), "utf8");
  assert.match(source, /const ZERO_CHARGE_COMPILE_LOCK = true;/);
  assert.match(source, /ZERO_CHARGE_COMPILE_LOCK \|\|/);
  assert.match(source, /assertGeminiSpendPolicy\(env\);/);
});

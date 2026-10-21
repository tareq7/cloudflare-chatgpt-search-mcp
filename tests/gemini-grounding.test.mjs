import test from "node:test";
import assert from "node:assert/strict";
import { googleGroundedSearch, assertGeminiSpendPolicy, reserveRequest } from "../src/providers/gemini-grounding.js";
import { createServer } from "../src/server.js";

function fixture(overrides = {}) {
  const values = new Map();
  return {
    GEMINI_API_KEY: "FAKE_TEST_KEY",
    GEMINI_API_KEY_TIER: "paid",
    GEMINI_ZERO_SPEND_LOCK: "0",
    GEMINI_OUTBOUND_ENABLED: "1",
    GEMINI_GROUNDING_ENABLED: "1",
    GEMINI_SPEND_LIMIT_USD: "0.10",
    GROUNDING_PUBLIC_ORIGIN: "https://example.com",
    OAUTH_KV: {
      get: async (key) => values.get(key) ?? null,
      put: async (key,value) => { values.set(key,value); },
    },
    __values: values,
    ...overrides,
  };
}

test("guard fails closed for missing paid opt-in, no key, or invalid budget", async () => {
  for (const o of [
    { GEMINI_ZERO_SPEND_LOCK: "1" },
    { GEMINI_OUTBOUND_ENABLED: "0" },
    { GEMINI_GROUNDING_ENABLED: "0" },
    { GEMINI_API_KEY_TIER: "unverified" },
    { GEMINI_API_KEY: "" },
    { GEMINI_SPEND_LIMIT_USD: "0" },
    { GEMINI_SPEND_LIMIT_USD: "10" },
  ]) {
    assert.throws(() => assertGeminiSpendPolicy(fixture(o)), /disabled by policy/);
  }
});

test("advisory quotas reserve before API calls and reject monthly/day exhaustion", async () => {
  const e = fixture();
  await assert.rejects(() => reserveRequest(e, "X".repeat(351)), /3–350/);
  const one = await reserveRequest(e, "Cloudflare Workers");
  assert.equal(one.day_used, 1);
  assert.equal(one.month_used, 1);
  assert.equal(one.advisory_reserved_usd, 0.01);
  const two = await reserveRequest(e, "Cloudflare Workers API");
  assert.equal(two.day_used, 2);
  await assert.rejects(() => reserveRequest(e, "third request"), /budget reached/);
  const d = new Date().toISOString().slice(0,10);
  e.__values.set("gemini:paid:day:"+d,"0");
  e.__values.set("gemini:paid:month:"+d.slice(0,7),"10");
  await assert.rejects(() => reserveRequest(e, "monthly exhausted"), /budget reached/);
});

test("depleted Gemini prepay blocks subsequent requests locally", async () => {
  const e = fixture();
  e.__values.set("gemini:paid:billing-block", "402");
  const previousFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => { count++; throw new Error("Unexpected outbound fetch"); };
  try {
    await assert.rejects(() => googleGroundedSearch(e, { query: "Live Cloudflare docs" }), /prepayment is depleted/);
    assert.equal(count, 0);
  } finally { globalThis.fetch = previousFetch; }
});

test("opt-in Gemini request returns sources and mandatory Google search suggestions", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (url, options) => {
    count++;
    assert.match(String(url), /gemini-3\.8-flash:generateContent$/);
    assert.equal(options.headers["x-goog-api-key"], "FAKE_TEST_KEY");
    const payload = JSON.parse(options.body);
    assert.ok(payload.tools[0].google_search);
    assert.equal(payload.generationConfig.maxOutputTokens,768);
    assert.equal(payload.generationConfig.thinkingConfig.thinkingLevel,"low");
    return Response.json({ candidates: [{
      content: { parts: [{text:"Cloudflare Workers is serverless."}] },
      groundingMetadata: {
        groundingChunks: [{web:{title:"Official Cloudflare Docs",uri:"https://developers.cloudflare.com/workers/"}}],
        groundingSupports: [{ segment:{text:"Cloudflare Workers is serverless."},groundingChunkIndices:[0] }],
        searchEntryPoint:{renderedContent:'<a href="https://google.com/search?q=workers">Google Search</a>'},
        webSearchQueries:["cloudflare workers"]
      }
    }]});
  };
  try {
    const e=fixture();
    const result=await googleGroundedSearch(e,{query:"Cloudflare Workers?"});
    assert.equal(count,1);
    assert.equal(result.model,"gemini-3.8-flash");
    assert.equal(result.grounded,true);
    assert.equal(result.local_quota.day_used,1);
    assert.equal(result.sources.length,1);
    assert.match(result.view_url,/\/grounded\/[0-9a-f]{48}$/);
    const html=await e.OAUTH_KV.get("gemini:grounded:view:"+result.view_url.split("/").at(-1));
    assert.match(html,/Google Search/);
    assert.match(html,/Official Cloudflare Docs/);
    const blocked=await createServer(e)._registeredTools.google_grounded_search.handler({query:"repeat immediately"});
    assert.equal(blocked.isError,true);
    assert.match(blocked.content[0].text,/cooldown/);
    assert.equal(count,1);
  } finally { globalThis.fetch=original; }
});

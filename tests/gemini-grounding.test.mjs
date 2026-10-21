import test from "node:test";
import assert from "node:assert/strict";
import { googleGroundedSearch } from "../src/providers/gemini-grounding.js";

function fakeEnv(overrides = {}) {
  const state = new Map();
  return {
    GEMINI_GROUNDING_ENABLED: "1", GEMINI_FREE_TIER_CONFIRMED: "1",
    GEMINI_API_KEY: "fake-unbilled-key",
    GROUNDING_PUBLIC_ORIGIN: "https://example.com",
    OAUTH_KV: {
      async get(k) { return state.get(k) || null; },
      async put(k, v) { state.set(k, v); },
    },
    ...overrides,
  };
}
test("free-tier gate fails closed when billing safety confirmation is missing", async () => {
  await assert.rejects(
    () => googleGroundedSearch(fakeEnv({ GEMINI_FREE_TIER_CONFIRMED: "0" }), { query: "test query" }),
    /disabled.*unbilled/,
  );
});
test("Gemini free grounding returns sources, suggestion viewer and bounded daily quota", async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, opts) => {
    calls++;
    assert.match(url, /gemini-2\.5-flash:generateContent$/);
    assert.equal(opts.headers["x-goog-api-key"], "fake-unbilled-key");
    assert.equal(JSON.parse(opts.body).tools[0].google_search !== undefined, true);
    return Response.json({ candidates: [{
      content: { parts: [{ text: "Cloudflare Workers are serverless." }] },
      groundingMetadata: {
        groundingChunks: [{ web: { title: "Cloudflare Docs", uri: "https://developers.cloudflare.com/workers/" } }],
        groundingSupports: [{ segment: { text: "Cloudflare Workers are serverless." }, groundingChunkIndices: [0] }],
        webSearchQueries: ["Cloudflare Workers docs"],
        searchEntryPoint: { renderedContent: '<a href="https://google.com/search?q=cloudflare">Google search</a>' },
      },
    }] });
  };
  try {
    const env = fakeEnv();
    const result = await googleGroundedSearch(env, { query: "What is Cloudflare Workers?" });
    assert.equal(result.model, "gemini-2.5-flash");
    assert.equal(result.grounded, true);
    assert.equal(result.sources.length, 1);
    assert.match(result.view_url, /\/grounded\/[0-9a-f]{48}$/);
    assert.equal(result.local_quota.used, 1);
    assert.equal(calls, 1);
    const id = result.view_url.split("/").at(-1);
    const page = await env.OAUTH_KV.get("gemini:grounded:view:" + id);
    assert.match(page, /Google search/);
    assert.match(page, /Cloudflare Workers are serverless/);
    assert.match(page, /Cloudflare Docs/);
  } finally { globalThis.fetch = orig; }
});
test("429 quota errors cannot trigger a paid fallback", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 429 });
  try {
    await assert.rejects(() => googleGroundedSearch(fakeEnv(), { query: "test query" }), /no paid fallback/);
  } finally { globalThis.fetch = orig; }
});

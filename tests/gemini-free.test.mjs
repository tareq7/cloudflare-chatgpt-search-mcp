import test from "node:test";
import assert from "node:assert/strict";
import { geminiFreeResearch, assertFreeGeminiConfiguration } from "../src/providers/gemini-free.js";
import { createServer } from "../src/server.js";

const goodSources = { backend: "free", results: [
  { title: "Cloudflare Workers docs", url: "https://developers.cloudflare.com/workers/", domain: "developers.cloudflare.com", description: "Cloudflare Workers runs code at the edge." },
  { title: "Cloudflare Blog", url: "https://blog.cloudflare.com/workers/", domain: "blog.cloudflare.com", description: "Workers documentation and examples." }
] };

function env(overrides={}) {
  const kv = new Map();
  return {
    GEMINI_FREE_ENABLED: "1", GEMINI_FREE_PROJECT_CONFIRMED: "1",
    GEMINI_FREE_API_KEY: "test-only-free-key",
    GEMINI_GROUNDING_ENABLED: "0", GEMINI_OUTBOUND_ENABLED: "0",
    OAUTH_KV: { get: async k => kv.get(k) ?? null, put: async(k,v)=>{kv.set(k,v);} },
    ...overrides
  };
}

test("Free Gemini refuses missing/unverified secret and any enabled paid Gemini path", async () => {
  for(const delta of [
    {GEMINI_FREE_ENABLED:"0"}, {GEMINI_FREE_PROJECT_CONFIRMED:"0"},
    {GEMINI_FREE_API_KEY:""}, {GEMINI_GROUNDING_ENABLED:"1"},
    {GEMINI_OUTBOUND_ENABLED:"1"}
  ]) {
    assert.throws(()=>assertFreeGeminiConfiguration(env(delta)),/Free Gemini inactive/);
  }
});

test("Free Gemini research never uses Google's built-in Search Grounding", async () => {
  const calls = [];
  const output = await geminiFreeResearch(env(), {query:"Explain Cloudflare Workers"}, {
    searcher: async (_env, args) => { assert.equal(args.backend,"free"); return goodSources; },
    geminiFetch: async (url, options) => {
      const body=JSON.parse(options.body);
      calls.push({url,options,body});
      assert.equal(options.headers["x-goog-api-key"],"test-only-free-key");
      assert.equal(body.tools,undefined);
      assert.equal(body.generationConfig.maxOutputTokens,900);
      return Response.json({candidates:[{content:{parts:[{text:"Cloudflare Workers is an edge platform [1]."}]}}]});
    }
  });
  assert.equal(calls.length,1);
  assert.equal(output.status,"ok");
  assert.equal(output.google_search_grounding,false);
  assert.equal(output.sources.length,2);
  assert.equal(output.quota.daily_used,1);
  assert.match(output.answer,/\[1\]/);
  assert.match(calls[0].url,/gemini-3\.8-flash:generateContent$/);
});

test("Source-less queries and missing free key never call Google API", async () => {
  let count=0;
  const deps={searcher:async()=>({backend:"free",results:[]}),geminiFetch:async()=>{count++;throw Error("Unexpected request");}};
  const noResult=await geminiFreeResearch(env(),{query:"research question"},deps);
  assert.equal(noResult.status,"no_sources");
  await assert.rejects(()=>geminiFreeResearch(env({GEMINI_FREE_API_KEY:""}),{query:"research question"},deps),/Free Gemini inactive/);
  assert.equal(count,0);
});

test("Free-tier quota errors return real source links without paid fallback or retries", async () => {
  // Cooldown is per isolate and may be active from previous test; if so it still makes zero paid calls.
  let calls=0;
  const output=await geminiFreeResearch(env(),{query:"Another research question"},{searcher:async()=>goodSources,
    geminiFetch:async()=>{calls++;return new Response("",{status:429});}});
  assert.ok(["model_unavailable","model_cooldown"].includes(output.status));
  assert.equal(output.sources.length,2);
  assert.ok(calls<=1);
});

test("MCP exposes free research but not paid Google-grounded search", () => {
  const server=createServer(env());
  assert.ok(server._registeredTools.gemini_free_research);
  assert.ok(!server._registeredTools.google_grounded_search);
});

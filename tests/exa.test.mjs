import test from "node:test";
import assert from "node:assert/strict";
import { searchExa } from "../src/providers/exa.js";
import { searchWeb } from "../src/search.js";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockExaResponse = {
  requestId: "mock-exa-request-123",
  results: [
    {
      title: "UISKOOPW No Drill TV Safety Straps",
      url: "https://www.amazon.sa/dp/B0D1MMWM4S",
      text: "No drill C clamp TV anti tip safety straps for flat screen in Saudi Arabia warehouse stock.",
      publishedDate: "2026-05-01",
    },
    {
      title: "Internal Exa Link",
      url: "https://exa.ai/library/places?q=internal",
      text: "This should be discarded by provider filtering.",
    },
    {
      title: "Mount-It! TV Anti-Tip Safety Straps",
      url: "https://www.kanbkam.com/sa/en/mountit-tv-safety-straps",
      highlights: ["Heavy-duty metal C-clamp TV anchor baby proofing."],
    },
    {
      title: "Third Safe Strap TV Anchor",
      url: "https://www.extra.com/sa-en/straps",
      text: "C clamp anti tip safety strap for television in Saudi.",
    },
    {
      title: "Invalid Protocol",
      url: "ftp://files.example.com/item",
      text: "Bad protocol.",
    },
  ],
};

test("searchExa throws informative error when API key is missing", async () => {
  await assert.rejects(
    () => searchExa({}, { query: "test" }),
    /Exa API key not configured/i,
  );
});

test("searchExa formats query, headers, and payload correctly", async () => {
  let capturedUrl = null;
  let capturedHeaders = null;
  let capturedBody = null;

  globalThis.fetch = async (url, init) => {
    capturedUrl = new URL(url);
    capturedHeaders = init.headers;
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify(mockExaResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const results = await searchExa(
    { EXA_API_KEY: "test-exa-key" },
    {
      query: "no drill C clamp TV anti tip safety straps",
      limit: 5,
      mode: "news",
      domains: ["amazon.sa", "https://kanbkam.com/"],
    },
  );

  assert.equal(capturedUrl.origin, "https://api.exa.ai");
  assert.equal(capturedUrl.pathname, "/search");
  assert.equal(capturedHeaders["x-api-key"], "test-exa-key");
  assert.equal(capturedHeaders["User-Agent"], "CloudflareSearchMCP/1.0");
  assert.equal(capturedBody.query, "no drill C clamp TV anti tip safety straps");
  assert.equal(capturedBody.numResults, 5);
  assert.equal(capturedBody.category, "news");
  assert.deepEqual(capturedBody.includeDomains, ["amazon.sa", "kanbkam.com"]);

  assert.equal(results.length, 3);
  assert.equal(results[0].title, "UISKOOPW No Drill TV Safety Straps");
  assert.equal(results[0].url, "https://www.amazon.sa/dp/B0D1MMWM4S");
  assert.equal(results[0].source, "exa");
  assert.equal(results[1].url, "https://www.kanbkam.com/sa/en/mountit-tv-safety-straps");
  assert.equal(results[1].description, "Heavy-duty metal C-clamp TV anchor baby proofing.");
});

test("searchExa filters out exa.ai internal URLs", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(mockExaResponse), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const results = await searchExa(
    { EXA_API_KEY: "test-exa-key" },
    { query: "test query" },
  );

  assert.ok(results.every((r) => !r.url.includes("exa.ai")));
});

test("searchExa handles 401/403 authorization failures cleanly", async () => {
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });

  await assert.rejects(
    () => searchExa({ EXA_API_KEY: "bad-token" }, { query: "test" }),
    /Exa API token invalid or unauthorized \(HTTP 401\)/i,
  );
});

test("searchExa handles HTTP 429 with retry-after header", async () => {
  globalThis.fetch = async () => new Response("Too Many Requests", {
    status: 429,
    headers: { "retry-after": "45" },
  });

  await assert.rejects(
    () => searchExa({ EXA_API_KEY: "token" }, { query: "test" }),
    /Exa API rate limit exceeded \(HTTP 429\)\. Retry after 45s/i,
  );
});

test("searchWeb routes to Exa when backend is explicitly exa", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(mockExaResponse), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const res = await searchWeb(
    { EXA_API_KEY: "key123" },
    { query: "no drill C clamp TV anti tip safety straps", backend: "exa", limit: 5 },
  );

  assert.equal(res.backend, "exa");
  assert.equal(res.results.length, 3);
  assert.equal(res.results[0].title, "UISKOOPW No Drill TV Safety Straps");
});

test("searchWeb uses Exa as primary when backend is auto and EXA_API_KEY is present without SearXNG", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.exa.ai")) {
      return new Response(JSON.stringify(mockExaResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 500 });
  };

  const res = await searchWeb(
    { EXA_API_KEY: "key123" },
    { query: "no drill C clamp TV anti tip safety straps", backend: "auto", limit: 5 },
  );

  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].title, "UISKOOPW No Drill TV Safety Straps");
  assert.equal(res.backend, "auto:exa");
});

test("searchWeb falls back to Exa when SearXNG produces low-quality or empty results", async () => {
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes("search.example.org")) {
      // Return empty or irrelevant results
      return Response.json({ results: [] });
    }
    if (s.includes("api.exa.ai")) {
      return new Response(JSON.stringify(mockExaResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 500 });
  };

  const res = await searchWeb(
    {
      SEARXNG_URL: "https://search.example.org",
      EXA_API_KEY: "key123",
      ALLOW_PAID_WEBSEARCH: "0",
    },
    {
      query: "no drill C clamp TV anti tip safety straps",
      mode: "supplier",
      market: "SA",
      backend: "auto",
      limit: 3,
    },
  );

  assert.ok(res.fallbacks_attempted.includes("exa"));
  assert.ok(res.fallbacks_used.includes("exa"));
  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].title, "UISKOOPW No Drill TV Safety Straps");
});

test("searchWeb news mode falls back to Exa when RSS produces zero results", async () => {
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes("news.google.com") || s.includes("bing.com")) {
      return new Response("<rss><channel></channel></rss>", {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }
    if (s.includes("api.exa.ai")) {
      return new Response(JSON.stringify({
        results: [
          {
            title: "OpenAI DevDay Live News Coverage",
            url: "https://news.example.com/devday",
            text: "OpenAI announced new features at DevDay today.",
            publishedDate: "2026-10-08",
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 500 });
  };

  const res = await searchWeb(
    { EXA_API_KEY: "key123" },
    { query: "OpenAI DevDay", mode: "news", limit: 5 },
  );

  assert.equal(res.backend, "free-news-rss+exa");
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].title, "OpenAI DevDay Live News Coverage");
});

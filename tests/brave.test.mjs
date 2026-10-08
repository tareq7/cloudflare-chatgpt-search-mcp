import test from "node:test";
import assert from "node:assert/strict";
import { searchBrave } from "../src/providers/brave.js";
import { searchWeb } from "../src/search.js";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockBraveResponse = {
  query: { original: "test query" },
  web: {
    results: [
      {
        title: "Brave Search Result 1",
        url: "https://example.com/one",
        description: "Short snippet",
        extra_snippets: ["A much longer extra snippet that provides better context."],
      },
      {
        title: "Brave Search Result 2",
        url: "https://example.org/two",
        description: "Second result description",
      },
      {
        title: "Invalid URL Item",
        url: "javascript:void(0)",
        description: "Bad url",
      },
    ],
  },
};

test("searchBrave throws informative error when API key is missing", async () => {
  await assert.rejects(
    () => searchBrave({}, { query: "test" }),
    /Brave Search API key not configured/i,
  );
});

test("searchBrave formats query, headers, and market parameters correctly", async () => {
  let capturedUrl = null;
  let capturedHeaders = null;

  globalThis.fetch = async (url, init) => {
    capturedUrl = new URL(url);
    capturedHeaders = init.headers;
    return new Response(JSON.stringify(mockBraveResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const results = await searchBrave(
    { BRAVE_API_KEY: "test-token-xyz" },
    { query: "Saudi supplier tv strap", limit: 5, market: "SA" },
  );

  assert.equal(capturedUrl.origin, "https://api.search.brave.com");
  assert.equal(capturedUrl.pathname, "/res/v1/web/search");
  assert.equal(capturedUrl.searchParams.get("q"), "Saudi supplier tv strap");
  assert.equal(capturedUrl.searchParams.get("count"), "5");
  assert.equal(capturedUrl.searchParams.get("country"), "SA");
  assert.equal(capturedUrl.searchParams.get("search_lang"), "ar,en");
  assert.equal(capturedHeaders["X-Subscription-Token"], "test-token-xyz");
  assert.equal(capturedHeaders["User-Agent"], "CloudflareSearchMCP/1.0");

  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Brave Search Result 1");
  assert.equal(results[0].url, "https://example.com/one");
  assert.equal(results[0].description, "A much longer extra snippet that provides better context.");
  assert.equal(results[0].source, "brave");
  assert.equal(results[1].url, "https://example.org/two");
});

test("searchBrave handles 401/403 authorization failures cleanly", async () => {
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });

  await assert.rejects(
    () => searchBrave({ BRAVE_API_KEY: "bad-token" }, { query: "test" }),
    /Brave Search API token invalid or unauthorized \(HTTP 401\)/i,
  );
});

test("searchBrave handles HTTP 429 with retry-after header", async () => {
  globalThis.fetch = async () => new Response("Too Many Requests", {
    status: 429,
    headers: { "retry-after": "30" },
  });

  await assert.rejects(
    () => searchBrave({ BRAVE_API_KEY: "token" }, { query: "test" }),
    /Brave Search API rate limit exceeded \(HTTP 429\)\. Retry after 30s/i,
  );
});

test("searchWeb routes to Brave when backend is explicitly brave", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(mockBraveResponse), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const res = await searchWeb(
    { BRAVE_API_KEY: "key123" },
    { query: "Brave Search Result", backend: "brave", limit: 5 },
  );

  assert.equal(res.backend, "brave");
  assert.equal(res.results.length, 2);
  assert.equal(res.results[0].title, "Brave Search Result 1");
});

test("searchWeb uses Brave as primary when backend is auto and BRAVE_API_KEY is present without SearXNG", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.search.brave.com")) {
      return new Response(JSON.stringify(mockBraveResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 500 });
  };

  const res = await searchWeb(
    { BRAVE_API_KEY: "key123" },
    { query: "Brave Search Result", backend: "auto", limit: 5 },
  );

  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].title, "Brave Search Result 1");
});

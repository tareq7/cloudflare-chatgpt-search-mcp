import test from "node:test";
import assert from "node:assert/strict";
import { searchWeb, multiSearch, __test } from "../src/search.js";

const originalFetch = globalThis.fetch;

function ok(body, contentType = "text/html; charset=utf-8") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function ddgResult(title, url, snippet = "") {
  return [
    '<div class="result results_links web-result">',
    '<a class="result__a" href="' + url + '">' + title + "</a>",
    '<div class="result__snippet">' + snippet + "</div>",
    "</div>",
  ].join("");
}

function rssItem(title, url, description = "", sourceUrl = "", sourceName = "") {
  const source = sourceUrl
    ? '<source url="' + sourceUrl + '">' + sourceName + "</source>"
    : "";
  return [
    "<item>",
    "<title>" + title + "</title>",
    "<link>" + url + "</link>",
    "<description>" + description + "</description>",
    source,
    "</item>",
  ].join("");
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("canonicalizes Bing redirect targets instead of returning bing.com", () => {
  const encoded = Buffer.from("https://openai.com/research/").toString("base64url");
  const url = "https://www.bing.com/ck/a?u=a1" + encoded + "&ntb=1";
  assert.equal(__test.normalizeUrl(url), "https://openai.com/research/");
});

test("does not treat lookalike DuckDuckGo domains as redirect hosts", () => {
  const target = encodeURIComponent("https://openai.com/research/");
  const lookalike =
    "https://evilduckduckgo.com/l/?uddg=" + target;

  assert.equal(
    __test.normalizeUrl(lookalike),
    "https://evilduckduckgo.com/l/?uddg=" + target,
  );
});

test("strict domain filtering runs on canonical destinations", () => {
  const encoded = Buffer.from("https://openai.com/index/example").toString("base64url");
  const results = __test.postProcess([
    {
      title: "GPT research at OpenAI",
      url: "https://www.bing.com/ck/a?u=a1" + encoded,
      description: "OpenAI GPT model research",
      source: "bing-html",
    },
    {
      title: "GPT news elsewhere",
      url: "https://example.com/gpt",
      description: "GPT model story",
      source: "other",
    },
  ], "GPT model", ["openai.com"], 10);

  assert.equal(results.results.length, 1);
  assert.equal(results.results[0].domain, "openai.com");
});

test("provider fetch timeout aborts a stalled request", async () => {
  globalThis.fetch = async (_input, init = {}) =>
    await new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });

  await assert.rejects(
    () => __test.fetchText(
      "https://provider.example/search",
      {},
      { timeoutMs: 10, maxBytes: 4096 },
    ),
    /Timed out after 100 ms/,
  );
});

test("provider fetch rejects oversized responses before parsing", async () => {
  globalThis.fetch = async () =>
    new Response("small", {
      status: 200,
      headers: { "content-length": "5000" },
    });

  await assert.rejects(
    () => __test.fetchText(
      "https://provider.example/search",
      {},
      { timeoutMs: 500, maxBytes: 1024 },
    ),
    /exceeded 1024 bytes/,
  );
});

test("relevance gate rejects the unrelated benchmark failure classes", () => {
  const cases = [
    {
      query: "no-drill C-clamp TV anti-tip straps",
      good: "No-Drill TV Safety Straps with C-Clamp Anti-Tip Mount",
      bad: "Used Cars for Sale in Saudi Arabia",
    },
    {
      query: "TV anti-tip straps C-clamp manufacturer",
      good: "Factory Direct TV Safety Straps with C-Clamp Manufacturer",
      bad: "STM32CubeMX Development Tools Documentation",
    },
    {
      query: "Mac mini M4 dock UAE",
      good: "Mac mini M4 Dock and Hub in UAE",
      bad: "UAE Civil Defence Services",
    },
    {
      query: "Cloudflare remote MCP Workers OAuth",
      good: "Cloudflare Workers Remote MCP OAuth Documentation",
      bad: "Dentist Appointments and Betting Offers",
    },
  ];

  for (const item of cases) {
    const processed = __test.postProcess([
      {
        title: item.bad,
        url: "https://irrelevant.example/" + encodeURIComponent(item.bad),
        description: item.bad,
      },
      {
        title: item.good,
        url: "https://relevant.example/" + encodeURIComponent(item.good),
        description: item.good,
      },
    ], item.query, [], 10);

    assert.equal(processed.results.length, 1, item.query);
    assert.equal(processed.results[0].domain, "relevant.example", item.query);
  }
});

test("optional Bing RSS merges direct destinations without bing.com redirects", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.hostname === "html.duckduckgo.com") {
      return ok(
        ddgResult(
          "No-Drill TV Safety Straps with C-Clamp",
          "https://www.noon.com/saudi-en/tv-safety-straps/p",
          "Anti-tip C-clamp straps available in Saudi Arabia",
        ) +
        ddgResult(
          "Used Cars Saudi Arabia",
          "https://cars.example/saudi",
          "Used vehicles",
        ),
      );
    }

    if (url.hostname === "www.bing.com" && url.searchParams.get("format") === "rss") {
      return ok(
        "<rss><channel>" +
        rssItem(
          "TV Safety Straps C-Clamp Anti-Tip",
          "https://www.amazon.sa/example",
          "No-drill TV straps in KSA",
        ) +
        "</channel></rss>",
        "text/xml; charset=utf-8",
      );
    }

    throw new Error("unexpected URL " + url);
  };

  const result = await searchWeb(
    { ALLOW_PAID_WEBSEARCH: "0", ENABLE_BING_RSS: "1" },
    {
      query: "no-drill C-clamp TV anti-tip straps",
      mode: "supplier",
      market: "SA",
      limit: 5,
      backend: "free",
    },
  );

  assert.deepEqual(
    new Set(result.results.map((item) => item.domain)),
    new Set(["noon.com", "amazon.sa"]),
  );
  assert.ok(result.results.every((item) => item.domain !== "bing.com"));
});

test("Bing web RSS is opt-in and not requested by default", async () => {
  let rssRequested = false;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.hostname === "html.duckduckgo.com") {
      return ok(
        ddgResult(
          "Cloudflare Workers Remote MCP OAuth",
          "https://developers.cloudflare.com/agents/model-context-protocol/",
          "Remote MCP OAuth documentation for Cloudflare Workers",
        ) +
        ddgResult(
          "Build a Remote MCP Server on Workers",
          "https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/",
          "Cloudflare remote MCP server guide",
        ) +
        ddgResult(
          "Workers OAuth Provider",
          "https://developers.cloudflare.com/agents/model-context-protocol/authorization/",
          "OAuth authorization for MCP",
        ),
      );
    }

    if (url.hostname === "www.bing.com" && url.searchParams.get("format") === "rss") {
      rssRequested = true;
      return ok("<rss><channel></channel></rss>", "text/xml; charset=utf-8");
    }

    throw new Error("unexpected URL " + url);
  };

  const result = await searchWeb(
    { ALLOW_PAID_WEBSEARCH: "0" },
    {
      query: "Cloudflare remote MCP Workers OAuth",
      mode: "technical",
      limit: 3,
      backend: "free",
    },
  );

  assert.equal(rssRequested, false);
  assert.equal(result.results.length, 3);
});

test("news domains are enforced using publisher metadata", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.hostname === "news.google.com") {
      return ok(
        "<rss><channel>" +
        rssItem(
          "OpenAI DevDay announcement",
          "https://news.google.com/articles/one",
          "OpenAI DevDay coverage",
          "https://techcrunch.com/",
          "TechCrunch",
        ) +
        rssItem(
          "OpenAI DevDay market reaction",
          "https://news.google.com/articles/two",
          "OpenAI DevDay coverage",
          "https://www.cnbc.com/",
          "CNBC",
        ) +
        "</channel></rss>",
        "text/xml; charset=utf-8",
      );
    }

    if (url.hostname === "www.bing.com") {
      return ok("<rss><channel></channel></rss>", "text/xml; charset=utf-8");
    }

    throw new Error("unexpected URL " + url);
  };

  const result = await searchWeb(
    {},
    {
      query: "OpenAI DevDay",
      mode: "news",
      domains: ["techcrunch.com"],
      limit: 10,
    },
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].domain, "techcrunch.com");
});

test("localized fallback scores localized-only results with the market query", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const q = url.searchParams.get("q") || "";

    if (url.hostname === "html.duckduckgo.com") {
      if (q.includes("السعودية")) {
        return ok(
          ddgResult(
            "مورد السعودية مستودع مخزون محلي",
            "https://supplier.example/ar/item-1",
            "موزع السعودية مستودع مخزون محلي",
          ) +
          ddgResult(
            "السعودية موزع مستودع مخزون محلي",
            "https://supplier2.example/ar/item-2",
            "مورد السعودية مخزون محلي",
          ) +
          ddgResult(
            "مستودع السعودية مورد موزع مخزون محلي",
            "https://supplier3.example/ar/item-3",
            "السعودية مورد موزع",
          ),
        );
      }
      return ok(ddgResult(
        "Demon Slayer",
        "https://anime.example/show",
        "Anime series",
      ));
    }

    if (url.hostname === "lite.duckduckgo.com") {
      return ok("<html><body>No useful results</body></html>");
    }

    if (url.hostname === "www.bing.com") {
      return ok("<html><body>No organic results</body></html>");
    }

    throw new Error("unexpected URL " + url);
  };

  const result = await searchWeb(
    { ALLOW_PAID_WEBSEARCH: "0" },
    {
      query: "no-drill C-clamp TV anti-tip straps",
      mode: "supplier",
      market: "SA",
      limit: 3,
      backend: "auto",
    },
  );

  assert.equal(result.results.length, 3);
  assert.ok(result.results.every((item) => !("_relevanceQuery" in item)));
  assert.equal(result.auto.reason, "free_fallback_recovered");
});

test("auto uses free localized fallback before giving up when paid search is disabled", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const q = url.searchParams.get("q") || "";
    const decoded = decodeURIComponent(q);

    if (url.hostname === "html.duckduckgo.com") {
      if (decoded.includes("السعودية")) {
        return ok(
          ddgResult(
            "TV Safety Straps C-Clamp السعودية",
            "https://www.noon.com/saudi-en/tv-clamp/p",
            "No drill anti-tip TV straps",
          ) +
          ddgResult(
            "Anti-Tip C-Clamp TV Strap KSA",
            "https://www.amazon.sa/tv-clamp",
            "TV safety strap for Saudi Arabia",
          ) +
          ddgResult(
            "TV Strap Clamp Local Stock Saudi",
            "https://supplier.example/sa/tv-strap",
            "C-clamp anti-tip local stock",
          ),
        );
      }
      return ok(ddgResult(
        "Demon Slayer TV Anime",
        "https://anime.example/show",
        "Anime television",
      ));
    }

    if (url.hostname === "lite.duckduckgo.com") {
      return ok("<html><body>No useful results</body></html>");
    }

    if (url.hostname === "www.bing.com" && url.searchParams.get("format") === "rss") {
      return ok("<rss><channel></channel></rss>", "text/xml; charset=utf-8");
    }

    if (url.hostname === "www.bing.com") {
      return ok("<html><body>No organic results</body></html>");
    }

    throw new Error("unexpected URL " + url);
  };

  const result = await searchWeb(
    { ALLOW_PAID_WEBSEARCH: "0" },
    {
      query: "no-drill C-clamp TV anti-tip straps",
      mode: "supplier",
      market: "SA",
      limit: 3,
      backend: "auto",
    },
  );

  assert.equal(result.results.length, 3);
  assert.ok(result.fallbacks_used.includes("market-localized"));
  assert.equal(result.auto.escalated, true);
  assert.equal(result.auto.reason, "free_fallback_recovered");
  assert.ok(result.search_queries.some((q) => q.includes("السعودية")));
});

test("fallback telemetry only reports providers that returned results", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.hostname === "html.duckduckgo.com") {
      return ok(ddgResult(
        "Irrelevant cars",
        "https://cars.example/",
        "Cars",
      ));
    }

    if (url.hostname === "lite.duckduckgo.com") {
      return ok([
        "<table>",
        "<tr><td><a class='result-link' href='https://developers.cloudflare.com/agents/model-context-protocol/'>Cloudflare remote MCP OAuth</a></td></tr>",
        "<tr><td class='result-snippet'>Cloudflare Workers MCP OAuth documentation</td></tr>",
        "</table>",
      ].join(""));
    }

    if (url.hostname === "www.bing.com") {
      return ok("<html><body>No organic results</body></html>");
    }

    throw new Error("unexpected URL " + url);
  };

  const result = await searchWeb(
    { ALLOW_PAID_WEBSEARCH: "0" },
    {
      query: "Cloudflare remote MCP Workers OAuth",
      mode: "technical",
      market: "global",
      limit: 1,
      backend: "auto",
    },
  );

  assert.deepEqual(result.fallbacks_used, ["duckduckgo-lite"]);
});

test("auto reports fallback attempts even when no fallback returns results", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (
      url.hostname === "html.duckduckgo.com" ||
      url.hostname === "lite.duckduckgo.com" ||
      url.hostname === "www.bing.com"
    ) {
      return ok("<html><body>No useful results</body></html>");
    }
    throw new Error("unexpected URL " + url);
  };

  const result = await searchWeb(
    {},
    {
      query: "Cloudflare remote MCP Workers OAuth",
      mode: "web",
      market: "global",
      limit: 3,
      backend: "auto",
    },
  );

  assert.equal(result.results.length, 0);
  assert.equal(result.auto.escalated, true);
  assert.equal(result.auto.reason, "free_fallbacks_exhausted");
  assert.deepEqual(
    result.fallbacks_attempted,
    ["duckduckgo-lite", "bing-html"],
  );
  assert.deepEqual(result.fallbacks_used, []);
});

test("market fallback variants cover China and UAE sourcing", () => {
  assert.match(
    __test.buildMarketFallbackQuery(
      "TV anti-tip straps C-clamp",
      "supplier",
      "CN",
      [],
    ),
    /中国/,
  );

  assert.match(
    __test.buildMarketFallbackQuery(
      "Mac mini M4 dock",
      "commerce",
      "AE",
      [],
    ),
    /الإمارات/,
  );
});

test("multiSearch executes queries concurrently and merges distinct results", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    const query = u.searchParams.get("q") || "";
    if (query.includes("TV straps")) {
      return ok(ddgResult("TV safety strap listing", "https://amazon.sa/dp/B001", "Heavy duty C clamp straps"));
    }
    if (query.includes("Mac mini")) {
      return ok(ddgResult("Mac mini M4 dock", "https://amazon.ae/dp/B002", "Aluminum stand hub dock"));
    }
    return ok("");
  };

  const res = await multiSearch({}, {
    queries: ["TV straps", "Mac mini"],
    mode: "web",
    market: "global",
    limit_per_query: 3,
  });

  assert.equal(res.queries.length, 2);
  assert.equal(res.per_query.length, 2);
  assert.ok(res.results.length >= 2);
  assert.ok(res.results.some((r) => r.domain === "amazon.sa"));
  assert.ok(res.results.some((r) => r.domain === "amazon.ae"));
});

test("multiSearch isolates errors so a failed query does not corrupt healthy query results", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    const query = u.searchParams.get("q") || "";
    if (query.includes("exploding query")) {
      throw new Error("Simulated upstream network fault");
    }
    return ok(ddgResult("Healthy query safe result", "https://example.com/safe", "Healthy query working documentation snippet"));
  };

  const res = await multiSearch({}, {
    queries: ["exploding query", "healthy query"],
    mode: "web",
    market: "global",
    limit_per_query: 3,
  });

  assert.equal(res.queries.length, 2);
  assert.equal(res.per_query.length, 2);
  assert.equal(res.per_query[0].results.length, 0);
  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].domain, "example.com");
});

test("multiSearch handles empty queries array gracefully", async () => {
  const res = await multiSearch({}, { queries: [] });
  assert.deepEqual(res.queries, []);
  assert.deepEqual(res.results, []);
  assert.deepEqual(res.per_query, []);
});

test("relevance gate rejects generic homepages matching only one query term on multi-term queries", () => {
  const query = "Cloudflare remote MCP Workers OAuth";
  const processed = __test.postProcess([
    {
      title: "Cloudflare: Build for the agent era",
      url: "https://www.cloudflare.com/",
      description: "Join thousands of developers who have deployed globally with Cloudflare.",
    },
    {
      title: "Cloudflare Dashboard | Manage Your Account",
      url: "https://dash.cloudflare.com/login",
      description: "Log in to the Cloudflare dashboard to manage your account.",
    },
    {
      title: "Cloudflare Workers Remote MCP Server with OAuth",
      url: "https://blog.cloudflare.com/remote-mcp-oauth/",
      description: "Step-by-step documentation on building a remote Model Context Protocol server on Workers with OAuth authentication.",
    },
  ], query, [], 5);

  assert.equal(processed.results.length, 1);
  assert.equal(processed.results[0].url, "https://blog.cloudflare.com/remote-mcp-oauth/");
  assert.ok(processed.quality.discarded_low_relevance >= 2);
});

test("relevance gate rejects zero-match candidates and never retains completely unrelated domains like ilovepdf", () => {
  const query = "no drill C clamp TV anti tip safety straps";
  const processed = __test.postProcess([
    {
      title: "iLovePDF | Online PDF tools for PDF lovers",
      url: "https://www.ilovepdf.com/",
      description: "iLovePDF is an online service to work with PDF files completely free and easy to use. Merge, split, compress.",
    },
    {
      title: "Used Cars for Sale in Saudi Arabia",
      url: "https://cars.example.com/used-cars",
      description: "Find the best deals on pre-owned sedans and SUVs.",
    },
  ], query, [], 5);

  assert.equal(processed.results.length, 0);
  assert.equal(processed.quality.kept, 0);
  assert.equal(processed.quality.top_score, 0);
  assert.equal(processed.quality.discarded_low_relevance, 2);
});

test("multiSearch provides consistent top-level quality, backend, and error telemetry", async () => {
  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    const query = u.searchParams.get("q") || "";
    if (query.includes("straps")) {
      return ok(ddgResult("Anti-Tip TV Straps Heavy Duty", "https://amazon.sa/dp/B001", "C clamp TV straps safety"));
    }
    return ok("");
  };

  const res = await multiSearch({}, {
    queries: ["TV straps"],
    mode: "web",
    market: "SA",
    limit_per_query: 3,
    backend: "auto",
  });

  assert.equal(res.queries.length, 1);
  assert.ok(typeof res.backend === "string");
  assert.ok(res.quality && typeof res.quality.top_score === "number");
  assert.ok(Array.isArray(res.errors));
  assert.ok(Array.isArray(res.fallbacks_attempted));
  assert.ok(Array.isArray(res.fallbacks_used));
  assert.ok(res.results.length >= 1);
});

test("provider fetch rejects HTTP 202 bot challenge responses", async () => {
  globalThis.fetch = async () => new Response("challenge", { status: 202 });
  await assert.rejects(
    () => __test.fetchText("https://html.duckduckgo.com/html/?q=test"),
    /HTTP 202/,
  );
});

test("isGenericHomepage detects login and index variant pages", () => {
  assert.equal(__test.isGenericHomepage("https://example.com/signin"), true);
  assert.equal(__test.isGenericHomepage("https://example.com/auth/login"), true);
  assert.equal(__test.isGenericHomepage("https://example.com/index.php"), true);
  assert.equal(__test.isGenericHomepage("https://example.com/products/c-clamp"), false);
});

test("searchDuckDuckGoLite falls back to POST if GET encounters 202 challenge", async () => {
  const origFetch = globalThis.fetch;
  const methods = [];
  globalThis.fetch = async (url, init = {}) => {
    methods.push(init.method || "GET");
    if ((init.method || "GET") === "GET") {
      return new Response("bots use DuckDuckGo too", { status: 202 });
    }
    return new Response(`
      <table>
        <tr>
          <td>
            <a class="result-link" href="https://developers.cloudflare.com/agents/mcp">Remote MCP Workers</a>
          </td>
        </tr>
        <tr>
          <td class="result-snippet">Cloudflare Workers MCP server with OAuth</td>
        </tr>
      </table>
    `, { status: 200 });
  };

  try {
    const results = await __test.searchDuckDuckGoLite("cloudflare mcp", 5);
    assert.deepEqual(methods, ["GET", "POST"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Remote MCP Workers");
    assert.equal(results[0].url, "https://developers.cloudflare.com/agents/mcp");
  } finally {
    globalThis.fetch = origFetch;
  }
});



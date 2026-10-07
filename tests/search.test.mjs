import test from "node:test";
import assert from "node:assert/strict";
import { searchWeb, __test } from "../src/search.js";

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

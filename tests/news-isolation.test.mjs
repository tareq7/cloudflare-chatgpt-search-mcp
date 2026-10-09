import test from "node:test";
import assert from "node:assert/strict";
import { searchWeb } from "../src/search.js";

test("malformed Bing RSS does not discard valid Google News results",async()=>{
  const old=globalThis.fetch;
  const googleFeed='<rss version="2.0"><channel><item>'+
    '<title>Cloudflare Workers MCP OAuth development guide</title>'+
    '<link>https://developers.cloudflare.com/agents/model-context-protocol/</link>'+
    '<description>Cloudflare Workers OAuth MCP integration guide</description>'+
    '</item></channel></rss>';
  globalThis.fetch=async(input)=>{
    const u=new URL(String(input));
    return new Response(u.hostname==="news.google.com"
      ? googleFeed : "<html><body>blocked, not RSS</body></html>",
      {status:200,headers:{"content-type":"text/xml"}});
  };
  try {
    const out=await searchWeb({},{
      query:"Cloudflare Workers MCP OAuth",mode:"news",market:"global",backend:"free",limit:5
    });
    assert.equal(out.backend,"free-news-rss");
    assert.ok(out.results.length>=1);
    assert.ok(out.results.some(x=>x.domain==="developers.cloudflare.com"));
  } finally {globalThis.fetch=old;}
});

test("Bing News apiclick destination and News:Source publisher extraction works", async () => {
  const old = globalThis.fetch;
  const bingFeed = '<rss version="2.0"><channel><item>' +
    '<title>TechCrunch on OpenAI DevDay launches</title>' +
    '<link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2ftechcrunch.com%2farticle%2fopenai-devday</link>' +
    '<description>Coverage of OpenAI DevDay announcements</description>' +
    '<News:Source>TechCrunch</News:Source>' +
    '</item></channel></rss>';

  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    if (u.hostname === "www.bing.com") {
      return new Response(bingFeed, { status: 200, headers: { "content-type": "text/xml" } });
    }
    return new Response("<rss><channel></channel></rss>", { status: 200, headers: { "content-type": "text/xml" } });
  };

  try {
    const out = await searchWeb({}, {
      query: "OpenAI DevDay", mode: "news", market: "global", backend: "free", limit: 5
    });
    assert.equal(out.backend, "free-news-rss");
    assert.ok(out.results.length >= 1);
    assert.equal(out.results[0].url, "https://techcrunch.com/article/openai-devday");
    assert.equal(out.results[0].domain, "techcrunch.com");
    assert.equal(out.results[0].publisher, "TechCrunch");
  } finally { globalThis.fetch = old; }
});

test("news mode falls back to web news when RSS feeds return empty results", async () => {
  const old = globalThis.fetch;
  const ddgHtml = '<div class="result results_links web-result">' +
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftechcrunch.com%2Fnews%2Fstory&rut=1">TechCrunch Breaking News on OpenAI</a>' +
    '<div class="result__snippet">Full reporting on OpenAI DevDay announcements</div>' +
    '</div>';

  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    if (u.hostname === "news.google.com" || u.hostname === "www.bing.com") {
      return new Response("<rss><channel></channel></rss>", { status: 200, headers: { "content-type": "text/xml" } });
    }
    if (u.hostname === "html.duckduckgo.com") {
      return new Response(ddgHtml, { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response("", { status: 404 });
  };

  try {
    const out = await searchWeb({}, {
      query: "OpenAI DevDay", mode: "news", market: "global", backend: "free", limit: 5,
      domains: ["techcrunch.com"]
    });
    assert.ok(out.results.length >= 1);
    assert.equal(out.results[0].domain, "techcrunch.com");
  } finally { globalThis.fetch = old; }
});


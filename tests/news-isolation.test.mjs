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

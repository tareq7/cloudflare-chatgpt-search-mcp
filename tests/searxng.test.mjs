import test from "node:test";
import assert from "node:assert/strict";
import { searchSearxng } from "../src/providers/searxng.js";
import { searchWeb } from "../src/search.js";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

function sample() {
  return {
    query: "C clamp TV safety strap",
    results: [
      { title: "No Drill TV Safety C-Clamp Straps Saudi", url: "https://www.noon.com/saudi-en/strap", content: "TV anti-tip C clamp no drill Saudi", engines: ["brave", "google"], score: 6.7 },
      { title: "TV C-Clamp Anti Tip Straps Saudi Arabia", url: "https://www.amazon.sa/strap", content: "No drill TV safety straps", engines: ["brave"], score: 5.5 },
      { title: "Manufacturer TV Anti-Tip C-Clamp Straps", url: "https://www.made-in-china.com/strap", content: "Wholesale factory OEM TV straps", engines: ["bing"], score: 4.2 },
    ],
    unresponsive_engines: []
  };
}

test("uses the official SearXNG JSON API and maps results without credentials in output", async () => {
  let requested;
  globalThis.fetch = async (url, init) => {
    requested={url:String(url), init};
    return Response.json(sample());
  };
  const result=await searchSearxng(
    { SEARXNG_URL:"https://search.example.org/", SEARXNG_BEARER_TOKEN:"private-test-token" },
    {query:"TV anti-tip C-clamp straps",market:"SA",mode:"supplier",limit:3}
  );
  const u=new URL(requested.url);
  assert.equal(u.pathname,"/search");
  assert.equal(u.searchParams.get("format"),"json");
  assert.equal(u.searchParams.get("categories"),"general");
  assert.equal(u.searchParams.get("language"),"ar-SA");
  assert.equal(requested.init.headers.Authorization,"Bearer private-test-token");
  assert.equal(result.length,3);
  assert.equal(result[0].domain,undefined);
  assert.equal(result[0].source,"searxng");
  assert.equal(result[0].description,"TV anti-tip C clamp no drill Saudi");
  assert.equal(JSON.stringify(result).includes("private-test-token"),false);
});

test("refuses insecure SearXNG URLs and embedded URL credentials",async()=>{
  globalThis.fetch=async()=>{throw new Error("should not fetch")};
  for(const base of ["http://internal.example.org","https://alice:password@search.example.org","https://127.0.0.1"]) {
    await assert.rejects(
      ()=>searchSearxng({SEARXNG_URL:base},{query:"foo",market:"SA",mode:"web",limit:3}),
      /SearXNG|HTTPS|credentials|private|public/i
    );
  }
});

test("rejects invalid JSON response and oversized response",async()=>{
  globalThis.fetch=async()=>new Response("<html>not JSON</html>",{headers:{"content-type":"text/html"}});
  await assert.rejects(
    ()=>searchSearxng({SEARXNG_URL:"https://search.example.org"},{query:"clamp",market:"SA",mode:"web",limit:3}),
    /JSON|content-type/i
  );
  globalThis.fetch=async()=>new Response("x",{headers:{"content-type":"application/json","content-length":"10000000"}});
  await assert.rejects(
    ()=>searchSearxng({SEARXNG_URL:"https://search.example.org"},{query:"clamp",market:"SA",mode:"web",limit:3}),
    /exceeded|too large/i
  );
});

test("auto prefers configured SearXNG results and avoids fragile HTML scrapers when quality is good",async()=>{
  const calls=[];
  globalThis.fetch=async(url)=>{
    calls.push(String(url));
    if(new URL(String(url)).hostname!=="search.example.org")throw new Error("should not scrape DDG");
    return Response.json(sample());
  };
  const out=await searchWeb(
    {SEARXNG_URL:"https://search.example.org",ALLOW_PAID_WEBSEARCH:"0"},
    {query:"TV anti-tip C-clamp straps",mode:"supplier",market:"SA",backend:"auto",limit:3}
  );
  assert.equal(out.results.length,3);
  assert.ok(out.results.every(x=>x.source==="searxng"));
  assert.ok(out.backend.includes("searxng"));
  assert.equal(calls.length,1);
});

test("auto degrades to free search if the configured SearXNG instance fails",async()=>{
  const called=[];
  globalThis.fetch=async(url)=>{
    const u=new URL(String(url));
    called.push(u.hostname);
    if(u.hostname==="search.example.org")return new Response("unavailable",{status:503});
    if(u.hostname==="html.duckduckgo.com"){
      return new Response('<div class="result"><a class="result__a" href="https://www.noon.com/saudi-en/tv-straps">No Drill C-Clamp TV Safety Straps</a><div class="result__snippet">TV anti-tip straps Saudi</div></div>',{status:200});
    }
    return new Response("<html></html>",{status:200});
  };
  const out=await searchWeb(
    {SEARXNG_URL:"https://search.example.org",ALLOW_PAID_WEBSEARCH:"0"},
    {query:"TV anti-tip C-clamp straps",mode:"supplier",market:"SA",backend:"auto",limit:1}
  );
  assert.ok(called.includes("html.duckduckgo.com"));
  assert.ok(out.errors.some(x=>x.toLowerCase().includes("searxng")));
  assert.equal(out.results[0]?.domain,"noon.com");
});

test("explicit SearXNG backend reports missing configuration instead of pretending it searched",async()=>{
  await assert.rejects(
    ()=>searchWeb({}, {query:"TV safety straps",mode:"web",backend:"searxng"}),
    /SEARXNG_URL|not configured/i
  );
});

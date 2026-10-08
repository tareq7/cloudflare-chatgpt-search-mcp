import test from "node:test";
import assert from "node:assert/strict";
import { searchSearxng, configuredSearxngEndpoints, __clearSearxngCooldownsForTests } from "../src/providers/searxng.js";
import { searchWeb } from "../src/search.js";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; __clearSearxngCooldownsForTests(); });

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
  __clearSearxngCooldownsForTests();
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


test("serial failover tries the second configured host after a genuine outage", async()=>{
  const calls=[];
  globalThis.fetch=async(url)=>{
    const host=new URL(url).hostname;
    calls.push(host);
    if(host==="failed.example.org")return new Response("unavailable",{status:503});
    if(host==="backup.example.org")return Response.json(sample());
    throw new Error("unexpected host "+host);
  };
  const diagnostic={attempted:[],skipped:[],selected:null};
  const matches=await searchSearxng(
    {SEARXNG_URLS:"https://failed.example.org, https://backup.example.org",SEARXNG_MAX_ATTEMPTS:"2"},
    {query:"C clamp TV anti tip straps",market:"SA",limit:3,diagnostics:diagnostic}
  );
  assert.deepEqual(calls,["failed.example.org","backup.example.org"]);
  assert.equal(matches.length,3);
  assert.equal(diagnostic.selected,"https://backup.example.org");
  assert.deepEqual(diagnostic.attempted,["https://failed.example.org","https://backup.example.org"]);
});

test("public API denial or rate-limit stops instance rotation", async()=>{
  for(const status of [401,403,429]){
    __clearSearxngCooldownsForTests();
    const calls=[];
    globalThis.fetch=async(url)=>{
      calls.push(new URL(url).hostname);
      return new Response("request denied",{status});
    };
    await assert.rejects(
      ()=>searchSearxng(
        {SEARXNG_URLS:"https://restricted.example.org,https://backup.example.org",SEARXNG_MAX_ATTEMPTS:"3"},
        {query:"C clamp TV straps",market:"SA",limit:3}
      ),
      /access or rate-limit denial/i
    );
    assert.deepEqual(calls,["restricted.example.org"],"did not retry on "+status);
  }
});

test("private bearer secret stays exclusively on the primary origin",async()=>{
  const headers=[];
  globalThis.fetch=async(url,opts)=>{
    const host=new URL(url).hostname;
    headers.push({host,authorization:opts.headers.Authorization});
    if(host==="primary.example.org")return new Response("unavailable",{status:503});
    return Response.json(sample());
  };
  const results=await searchSearxng(
    {SEARXNG_URL:"https://primary.example.org",SEARXNG_URLS:"https://backup.example.org",SEARXNG_BEARER_TOKEN:"top-secret",SEARXNG_MAX_ATTEMPTS:"2"},
    {query:"C clamp TV straps",limit:3}
  );
  assert.equal(results.length,3);
  assert.deepEqual(headers,[
    {host:"primary.example.org",authorization:"Bearer top-secret"},
    {host:"backup.example.org",authorization:undefined},
  ]);
  assert.ok(!JSON.stringify(results).includes("top-secret"));
});

test("configured chain rejects insecure or duplicate-host secrets and caps candidate URLs",()=>{
  assert.deepEqual(
    configuredSearxngEndpoints({SEARXNG_URLS:"https://good.example.org, https://good.example.org; https://backup.example.org"}).map(x=>x.origin),
    ["https://good.example.org","https://backup.example.org"]
  );
  assert.throws(
    ()=>configuredSearxngEndpoints({SEARXNG_URLS:"https://good.example.org",SEARXNG_BEARER_TOKEN:"secret"}),
    /requires a primary/i
  );
  for (const raw of ["https://localhost", "https://192.168.1.1", "http://good.example.org", "https://user:pass@good.example.org"]) {
    assert.throws(()=>configuredSearxngEndpoints({SEARXNG_URLS:raw}),/public HTTPS/i);
  }
});

test("empty first-instance results fall back without concurrent fanout",async()=>{
  const calls=[];
  globalThis.fetch=async(url)=>{
    const host=new URL(url).hostname;
    calls.push(host);
    if(host==="empty.example.org")return Response.json({results:[]});
    return Response.json(sample());
  };
  const result=await searchSearxng(
    {SEARXNG_URLS:"https://empty.example.org,https://backup.example.org",SEARXNG_MAX_ATTEMPTS:"2"},
    {query:"TV C clamp straps",market:"SA",limit:3}
  );
  assert.deepEqual(calls,["empty.example.org","backup.example.org"]);
  assert.equal(result.length,3);
});

test("valid but query-irrelevant JSON results do not cool down a healthy host",async()=>{
  __clearSearxngCooldownsForTests();
  const previous=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url)=>{
    calls.push(new URL(url).hostname);
    return Response.json(sample());
  };
  try {
    const env={SEARXNG_URL:"https://healthy.example.org"};
    await assert.rejects(
      ()=>searchSearxng(env,{query:"unrelated niche search",limit:3,isUseful:()=>false}),
      /low-relevance|unavailable/i
    );
    const result=await searchSearxng(env,{query:"TV straps",limit:3});
    assert.equal(result.length,3);
    assert.deepEqual(calls,["healthy.example.org","healthy.example.org"]);
  } finally {
    globalThis.fetch=previous;
    __clearSearxngCooldownsForTests();
  }
});

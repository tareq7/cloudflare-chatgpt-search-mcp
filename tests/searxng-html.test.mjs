import test from "node:test";
import assert from "node:assert/strict";
import { parseSearxngHtml } from "../src/parsers/searxng-html.js";
import { searchSearxng, configuredSearxngEndpoints, __clearSearxngCooldownsForTests } from "../src/providers/searxng.js";
import { searchWeb } from "../src/search.js";

const original = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = original;
  __clearSearxngCooldownsForTests();
});

const html = [
'<!doctype html><html><body>',
'<article class="result result-default"><header><h3><a href="https://example.org/tv-safety">TV C-Clamp <strong>Safety</strong> Straps</a></h3>',
'<a class="url_header" href="https://example.org/tv-safety">example.org</a></header>',
'<p class="content">Saudi no-drill anti-tip &amp; screen straps</p></article>',
'<article class="result"><h3><a href="https://example.net/oem-clamp">OEM TV Anti-Tip C-Clamp Manufacturer</a></h3>',
'<p class="content">China factory OEM supply</p></article>',
'<article class="result"><h3><a href="https://example.org/tv-safety">duplicate</a></h3></article>',
'<article class="result"><h3><a href="javascript:alert(1)">bad URL</a></h3></article>',
'<article class="result"><h3><a href="/search?q=internal">internal navigation</a></h3></article>',
'</body></html>'
].join("");

test("Cheerio parses ordinary SearXNG HTML with titles, descriptions, link validation and deduplication", () => {
  const rows = parseSearxngHtml(html, {origin:"https://search.example.org",limit:10});
  assert.equal(rows.length,2);
  assert.equal(rows[0].title,"TV C-Clamp Safety Straps");
  assert.equal(rows[0].description,"Saudi no-drill anti-tip & screen straps");
  assert.equal(rows[0].url,"https://example.org/tv-safety");
  assert.equal(rows[0].source_format,"html");
  assert.equal(rows[1].url,"https://example.net/oem-clamp");
  assert.equal(parseSearxngHtml(html,{origin:"https://search.example.org",limit:1}).length,1);
  assert.deepEqual(parseSearxngHtml("<div>blocked</div>",{origin:"https://search.example.org"}),[]);
});

test("HTML use requires exactly configured and approved HTTPS origin",()=>{
  assert.deepEqual(
    configuredSearxngEndpoints({SEARXNG_URL:"https://search.example.org",SEARXNG_HTML_ORIGINS:"https://search.example.org"}).map(x=>x.format),
    ["html"]
  );
  for (const invalid of [
    "http://search.example.org", "https://unapproved.example.org",
    "https://user:password@search.example.org",
  ]) {
    assert.throws(()=>configuredSearxngEndpoints({
      SEARXNG_URL:"https://search.example.org",
      SEARXNG_HTML_ORIGINS:invalid,
    }),/HTTPS|configured|host|credentials|allowed/i);
  }
});

test("explicit HTML mode sends only one query request without JSON, CSS, stealth or retries",async()=>{
  const calls=[];
  globalThis.fetch=async(url,opts)=>{
    calls.push({url:String(url),accept:opts.headers.Accept,redirect:opts.redirect});
    return new Response(html,{headers:{"content-type":"text/html"}});
  };
  const results=await searchSearxng({
    SEARXNG_URL:"https://search.example.org",
    SEARXNG_HTML_ORIGINS:"https://search.example.org",
  },{query:"TV anti-tip C-clamp straps",market:"SA",mode:"supplier",limit:4});
  assert.equal(results.length,2);
  assert.equal(calls.length,1);
  assert.equal(new URL(calls[0].url).searchParams.get("format"),null);
  assert.equal(calls[0].accept,"text/html");
  assert.equal(calls[0].redirect,"error");
  assert.equal(results[0].source_instance,"https://search.example.org");
});

test("a 403 or 429 from the HTML endpoint is not bypassed by another instance",async()=>{
  for(const status of [401,403,429]){
    __clearSearxngCooldownsForTests();
    const hits=[];
    globalThis.fetch=async(url)=>{hits.push(new URL(url).hostname);return new Response("denied",{status})};
    await assert.rejects(()=>searchSearxng({
      SEARXNG_URLS:"https://one.example.org,https://two.example.org",
      SEARXNG_HTML_ORIGINS:"https://one.example.org",
      SEARXNG_MAX_ATTEMPTS:"2",
    },{query:"TV straps",limit:2}),/denial/i);
    assert.deepEqual(hits,["one.example.org"]);
  }
});

test("mixed JSON primary to HTML backup uses sequential failover and never sends primary bearer to backup",async()=>{
  const calls=[];
  globalThis.fetch=async(url,opts)=>{
    const u=new URL(url);
    calls.push({host:u.hostname,format:u.searchParams.get("format"),auth:opts.headers.Authorization});
    if(u.hostname==="primary.example.org")return new Response("unavailable",{status:503});
    return new Response(html,{headers:{"content-type":"text/html"}});
  };
  const result=await searchSearxng({
    SEARXNG_URL:"https://primary.example.org",
    SEARXNG_URLS:"https://backup.example.org",
    SEARXNG_HTML_ORIGINS:"https://backup.example.org",
    SEARXNG_BEARER_TOKEN:"private-token",
    SEARXNG_MAX_ATTEMPTS:"2",
  },{query:"TV straps",limit:4});
  assert.equal(result.length,2);
  assert.deepEqual(calls,[
    {host:"primary.example.org",format:"json",auth:"Bearer private-token"},
    {host:"backup.example.org",format:null,auth:undefined},
  ]);
  assert.equal(JSON.stringify(result).includes("private-token"),false);
});

test("HTML provider is integrated with normal relevance and domain filtering",async()=>{
  globalThis.fetch=async(url)=>{
    if(new URL(url).hostname!=="search.example.org")throw new Error("unexpected free search request");
    return new Response(html,{headers:{"content-type":"text/html"}});
  };
  const out=await searchWeb({
    SEARXNG_URL:"https://search.example.org",
    SEARXNG_HTML_ORIGINS:"https://search.example.org",
  },{
    query:"TV C-Clamp Safety Straps",mode:"web",market:"global",backend:"searxng",limit:1,
    domains:["example.org"],
  });
  assert.equal(out.results.length,1);
  assert.equal(out.results[0].domain,"example.org");
  assert.equal(out.searxng_chain.selected,"https://search.example.org");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
  parseBingHtml,
} from "../src/parsers/search-html.js";

test("Cheerio parses DuckDuckGo HTML with attribute order, quotes, and nested markup",()=>{
 const html=[
  "<div class='result results_links web-result'>",
  "<a href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.noon.com%2Fsaudi-en%2Fitem' class='result__a'>",
  "Heavy duty <strong>TV C-clamp straps</strong></a>",
  "<div class='result__snippet'>No drill <b>Saudi</b> stock</div>",
  "</div>",
 ].join("");
 const r=parseDuckDuckGoHtml(html,10);
 assert.equal(r.length,1);
 assert.equal(r[0].title,"Heavy duty TV C-clamp straps");
 assert.equal(r[0].description,"No drill Saudi stock");
 assert.match(r[0].url,/duckduckgo.com\/l/);
});

test("Cheerio parses DDG Lite snippets with the correct result rather than another item",()=>{
 const html=[
   "<table><tr><td><a class='result-link' href='https://amazon.sa/a'>TV anti tip clamps</a></td></tr>",
   "<tr><td class='result-snippet'>No drill KSA product</td></tr>",
   "<tr><td><a class='result-link' href='https://noon.com/b'>Mac mini M4 dock</a></td></tr>",
   "<tr><td class='result-snippet'>USB4 hub UAE</td></tr></table>"
 ].join("");
 const results=parseDuckDuckGoLite(html,5);
 assert.equal(results.length,2);
 assert.equal(results[0].description,"No drill KSA product");
 assert.equal(results[1].description,"USB4 hub UAE");
});

test("Cheerio parses Bing organic SERP with tracking URLs for later canonicalization",()=>{
 const html="<li class='b_algo'><h2><a href='https://www.bing.com/ck/a?u=a1abc'>TV safety straps</a></h2>" +
   "<div><p>Clamps with no drilling required.</p></div></li>";
 const r=parseBingHtml(html,5);
 assert.equal(r[0].title,"TV safety straps");
 assert.equal(r[0].description,"Clamps with no drilling required.");
 assert.match(r[0].url,/bing.com\/ck/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseSearchRss } from "../src/parsers/rss.js";

test("parses multiple RSS items and preserves source URL attributes using fast-xml-parser",()=>{
  const xml = '<?xml version="1.0"?>' +
    '<rss version="2.0"><channel>' +
    '<item><title><![CDATA[OpenAI & DevDay]]></title><link>https://news.google.com/articles/id1</link>' +
    '<description><![CDATA[<p>OpenAI &amp; DevDay launches</p>]]></description>' +
    '<pubDate>Wed, 07 Oct 2026 10:00:00 GMT</pubDate>' +
    '<source url="https://techcrunch.com/">TechCrunch</source></item>' +
    '<item><title>Another story</title><link>https://www.example.org/p</link>' +
    '<source url="https://www.cnbc.com">CNBC</source></item></channel></rss>';
  const items=parseSearchRss(xml,{source:"google-news-rss",limit:10});
  assert.equal(items.length,2);
  assert.equal(items[0].publisher,"TechCrunch");
  assert.equal(items[0].publisher_url,"https://techcrunch.com/");
  assert.match(items[0].description,/OpenAI & DevDay launches/);
  assert.equal(items[1].publisher_url,"https://www.cnbc.com");
  assert.equal(items[1].source,"google-news-rss");
});

test("handles single-item feeds, malformed content, and limits without swallowing parsing issues",()=>{
 const single='<rss><channel><item><title>Hello</title><link>https://example.org/</link></item></channel></rss>';
 assert.equal(parseSearchRss(single,{source:"rss",limit:1}).length,1);
 assert.deepEqual(parseSearchRss('<rss><channel></channel></rss>',{source:"rss",limit:10}),[]);
 assert.deepEqual(parseSearchRss(single,{source:"rss",limit:0}),[]);
 assert.throws(()=>parseSearchRss("<not-a-feed>",{source:"rss",limit:10}),/RSS|XML|feed/i);
});

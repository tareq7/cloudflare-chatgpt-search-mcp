// Standalone HTML parsing backed by MIT-licensed Cheerio/slim (no network layer).
// Provider-specific markup selectors are isolated here for easier fixture testing.
import { load } from "cheerio/slim";

function text(value) {
  return value.text().replace(/\s+/g, " ").trim();
}

export function parseDuckDuckGoHtml(html, limit = 10) {
  const $ = load(html);
  const results = [];
  $(".result").each((_, el) => {
    if (results.length >= limit) return false;
    const a = $(el).find("a.result__a").first();
    const url = a.attr("href");
    if (!url) return;
    const title = text(a);
    if (!title) return;
    results.push({
      title,
      url,
      description: text($(el).find(".result__snippet").first()),
      source: "duckduckgo",
    });
  });
  return results;
}

export function parseDuckDuckGoLite(html, limit = 10) {
  const $ = load(html);
  const results = [];
  $("a.result-link").each((_, el) => {
    if (results.length >= limit) return false;
    const a = $(el);
    const url = a.attr("href");
    if (!url) return;
    let snippet = text(a.closest("tr").find(".result-snippet").first());
    if (!snippet) {
      let row = a.closest("tr").next();
      // Lite puts snippets in a subsequent row; don't cross into the next result.
      for (let i = 0; i < 4 && row.length; i += 1, row = row.next()) {
        if (row.find("a.result-link").length) break;
        const candidate = row.find(".result-snippet").first();
        if (candidate.length) {
          snippet = text(candidate);
          break;
        }
      }
    }
    results.push({
      title: text(a),
      url,
      description: snippet,
      source: "duckduckgo-lite",
    });
  });
  return results;
}

export function parseBingHtml(html, limit = 10) {
  const $ = load(html);
  const results = [];
  $("li.b_algo").each((_, el) => {
    if (results.length >= limit) return false;
    const a = $(el).find("h2 a").first();
    const url = a.attr("href");
    if (!url) return;
    const title = text(a);
    if (!title) return;
    const snippet = text($(el).find(".b_caption p").first()) ||
      text($(el).find(".b_snippet").first()) ||
      text($(el).find(".b_lineclamp").first()) ||
      text($(el).find("p").first());
    results.push({
      title,
      url,
      description: snippet,
      source: "bing-html",
    });
  });
  return results;
}

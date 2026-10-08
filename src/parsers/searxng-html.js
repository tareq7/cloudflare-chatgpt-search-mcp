// HTML result extraction adapted from the MIT-licensed mcp-searxng-public:
// https://github.com/pwilkin/mcp-searxng-public (src/index.ts).
// Uses the existing MIT-licensed Cheerio parser instead of fragile regexes.
// This module makes no network requests and performs no bot-control evasion.
import { load } from "cheerio/slim";

function cleanText(node) {
  return node.text().replace(/\s+/g, " ").trim();
}

function resultUrl(raw, origin) {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw, origin);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    // Exclude engine navigation, search links, and proxied result pages.
    if (url.origin === origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Extract structured results from a conventional SearXNG HTML response.
 * Operators may serve different templates. Empty results fail safely.
 * Call only for an explicitly approved SearXNG HTML origin.
 */
export function parseSearxngHtml(html, { origin, limit = 10 } = {}) {
  if (typeof html !== "string" || !origin) return [];
  const $ = load(html);
  const output = [];
  const seen = new Set();
  const max = Math.min(40, Math.max(0, Number(limit) || 0));

  $("article.result, div.result").each((_, element) => {
    if (output.length >= max) return false;
    const block = $(element);
    // Standard SearXNG has an h3 result title and an optional url_header.
    // Prefer actual title links; url_header often only contains a hostname.
    let anchor = block.find("h3 a[href], h4 a[href], .result_header a[href]").first();
    if (!anchor.length) anchor = block.find("a.url_header[href]").first();
    const url = resultUrl(anchor.attr("href"), origin);
    if (!url || seen.has(url)) return;

    let title = cleanText(anchor);
    if (!title || title.length < 4) title = cleanText(block.find("h3, h4").first());
    if (!title) return;

    const descNode = block.find("p.content, .result-content p, p.result-content, .content p").first();
    const description = descNode.length ? cleanText(descNode) : cleanText(block.find("p").first());

    seen.add(url);
    output.push({
      title: title.slice(0, 320),
      url,
      description: description.slice(0, 1200),
      source: "searxng",
      source_format: "html",
      source_instance: origin,
    });
  });
  return output;
}

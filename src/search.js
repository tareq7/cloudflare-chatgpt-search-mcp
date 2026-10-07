const UA = "CloudflareSearchMCP/1.0";

const MARKET = {
  global: { cc: "", label: "" },
  SA: { cc: "SA", label: "Saudi Arabia" },
  AE: { cc: "AE", label: "United Arab Emirates" },
  CN: { cc: "CN", label: "China" },
};

function decodeHtml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(value = "") {
  return decodeHtml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|font)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tag(block, name) {
  const lower = block.toLowerCase();
  const open = "<" + name.toLowerCase();
  const start = lower.indexOf(open);
  if (start < 0) return "";
  const bodyStart = block.indexOf(">", start);
  if (bodyStart < 0) return "";
  const end = lower.indexOf("</" + name.toLowerCase() + ">", bodyStart + 1);
  if (end < 0) return "";
  return stripHtml(block.slice(bodyStart + 1, end));
}

function decodeBingTarget(value) {
  if (!value) return "";
  let encoded = value;
  try {
    encoded = decodeURIComponent(encoded);
  } catch {}
  if (/^a\d/i.test(encoded)) encoded = encoded.slice(2);
  encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  encoded += "=".repeat((4 - (encoded.length % 4)) % 4);
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    return /^https?:\/\//i.test(decoded) ? decoded : "";
  } catch {
    return "";
  }
}

function normalizeUrl(raw, depth = 0) {
  if (!raw || depth > 3) return "";
  try {
    let value = decodeHtml(raw);
    if (value.startsWith("//")) value = "https:" + value;
    const u = new URL(value, "https://duckduckgo.com");
    const host = u.hostname.toLowerCase();

    if (host.endsWith("duckduckgo.com") && u.pathname.startsWith("/l/")) {
      const target = u.searchParams.get("uddg");
      return target ? normalizeUrl(target, depth + 1) : "";
    }

    if (host === "bing.com" || host.endsWith(".bing.com")) {
      if (u.pathname.startsWith("/ck/")) {
        const target = decodeBingTarget(u.searchParams.get("u"));
        return target ? normalizeUrl(target, depth + 1) : "";
      }
      if (u.pathname.startsWith("/aclick")) return "";
    }

    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|msclkid|mc_cid|mc_eid|ref_src|ref_url)$/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    return u.toString();
  } catch {
    return "";
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeDomain(value) {
  try {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return "";
    const u = new URL(text.includes("://") ? text : "https://" + text);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .replace(/^www\./, "");
  }
}

function matchesDomains(result, domains = []) {
  const wanted = domains.map(normalizeDomain).filter(Boolean);
  if (!wanted.length) return true;
  const candidate = normalizeDomain(result.publisher_url || result.url || "");
  return wanted.some((domain) =>
    candidate === domain || candidate.endsWith("." + domain)
  );
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "in", "is", "it", "of", "on", "or", "the", "to", "with",
]);

function queryTerms(query) {
  const matches = String(query || "")
    .toLowerCase()
    .normalize("NFKC")
    .match(/[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*/gu) || [];
  return [...new Set(matches.filter((term) => !STOPWORDS.has(term)))];
}

function relevanceDetails(result, query) {
  const terms = queryTerms(query);
  if (!terms.length) return { score: 1, matches: 0 };
  const title = String(result.title || "").toLowerCase().normalize("NFKC");
  const description = String(result.description || "").toLowerCase().normalize("NFKC");
  const url = String(result.url || "").toLowerCase();
  let weighted = 0;
  let matches = 0;
  for (const term of terms) {
    if (title.includes(term)) {
      weighted += 3;
      matches += 1;
    } else if (description.includes(term)) {
      weighted += 1.5;
      matches += 1;
    } else if (url.includes(term)) {
      weighted += 0.75;
      matches += 1;
    }
  }
  const normalizedQuery = terms.join(" ");
  const phraseBonus = normalizedQuery.length > 3 && title.includes(normalizedQuery) ? 0.2 : 0;
  return {
    score: Math.min(1, weighted / (terms.length * 3) + phraseBonus),
    matches,
  };
}

function postProcess(results, query, domains, limit) {
  const perDomainLimit = domains?.length ? Math.max(limit, 10) : 3;
  const canonical = dedupe(results, Math.max(limit * 4, 20), perDomainLimit)
    .filter((result) => matchesDomains(result, domains))
    .map((result) => {
      const relevance = relevanceDetails(result, query);
      return {
        ...result,
        _score: relevance.score,
        _matches: relevance.matches,
      };
    });

  const terms = queryTerms(query);
  const threshold = terms.length <= 1 ? 0.2 : terms.length <= 3 ? 0.18 : 0.14;
  const minimumMatches = terms.length >= 4 ? 2 : terms.length ? 1 : 0;
  const relevant = canonical
    .filter((result) =>
      result._score >= threshold && result._matches >= minimumMatches
    )
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  const topScore = relevant[0]?._score || canonical[0]?._score || 0;
  const avgTop3 = relevant.length
    ? relevant.slice(0, 3).reduce((sum, result) => sum + result._score, 0) / Math.min(3, relevant.length)
    : 0;

  return {
    results: relevant.map(({ _score, _matches, ...result }) => result),
    quality: {
      top_score: Number(topScore.toFixed(3)),
      average_top3: Number(avgTop3.toFixed(3)),
      kept: relevant.length,
      discarded_low_relevance: Math.max(0, canonical.length - relevant.length),
    },
  };
}

function dedupe(results, limit, perDomainLimit = 3) {
  const seen = new Set();
  const perDomain = new Map();
  const out = [];
  for (const r of results) {
    const url = normalizeUrl(r.url || "");
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    const host = hostOf(r.publisher_url || url) || hostOf(url);
    const count = perDomain.get(host) || 0;
    if (count >= perDomainLimit) continue;
    seen.add(key);
    perDomain.set(host, count + 1);
    out.push({ ...r, url, domain: host });
    if (out.length >= limit) break;
  }
  return out;
}

function buildQuery(query, mode, market, domains = []) {
  let q = query.trim();
  const place = MARKET[market]?.label || "";
  if (place && !q.toLowerCase().includes(place.toLowerCase())) q += " " + place;

  if (mode === "supplier") {
    q += market === "CN"
      ? " manufacturer factory OEM ODM wholesale supplier"
      : " supplier distributor wholesale warehouse local stock";
  } else if (mode === "commerce") {
    q += " product price retailer marketplace distributor";
  } else if (mode === "technical") {
    q += " documentation GitHub release changelog";
  }

  const cleanDomains = domains.map(normalizeDomain).filter(Boolean).slice(0, 5);
  if (cleanDomains.length === 1) {
    q += " site:" + cleanDomains[0];
  } else if (cleanDomains.length > 1) {
    q += " (" + cleanDomains.map((domain) => "site:" + domain).join(" OR ") + ")";
  }
  return q.slice(0, 1000);
}

async function fetchText(url, init = {}) {
  const res = await fetch(url, {
    redirect: "follow",
    ...init,
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      "Accept-Language": "en-US,en;q=0.8,ar;q=0.5",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " from " + new URL(url).hostname);
  return await res.text();
}

async function searchDuckDuckGo(query, limit) {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const html = await fetchText(url, { method: "GET" });
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"[^>]*>/i).slice(1);
  const results = [];
  for (const block of blocks) {
    const a = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]+href="([^"]+)"[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const sm = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    results.push({
      title: stripHtml(a[2]),
      url: normalizeUrl(a[1]),
      description: sm ? stripHtml(sm[1]) : "",
      source: "duckduckgo",
    });
    if (results.length >= limit) break;
  }
  return results;
}

async function searchDuckDuckGoLite(query, limit) {
  const url = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query);
  const html = await fetchText(url, { method: "GET" });
  const blocks = html.split(/<a\b/i).slice(1);
  const results = [];
  for (const block of blocks) {
    if (!/class=['"]result-link['"]/i.test(block)) continue;
    const href = block.match(/href=['"]([^'"]+)['"]/i);
    const openEnd = block.indexOf(">");
    const close = block.search(/<\/a>/i);
    if (!href || openEnd < 0 || close < 0) continue;
    const snippet = block.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i);
    results.push({
      title: stripHtml(block.slice(openEnd + 1, close)),
      url: normalizeUrl(href[1]),
      description: snippet ? stripHtml(snippet[1]) : "",
      source: "duckduckgo-lite",
    });
    if (results.length >= limit) break;
  }
  return results;
}

async function searchBing(query, limit, market) {
  const p = new URLSearchParams({ q: query, count: String(Math.min(limit + 4, 20)) });
  const cc = MARKET[market]?.cc;
  if (cc) p.set("cc", cc);
  p.set("setlang", "en");
  const html = await fetchText("https://www.bing.com/search?" + p.toString());
  const blocks = html.split(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[^>]*>/i).slice(1);
  const results = [];
  for (const block of blocks) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const pm = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    results.push({
      title: stripHtml(a[2]),
      url: normalizeUrl(a[1]),
      description: pm ? stripHtml(pm[1]) : "",
      source: "bing",
    });
    if (results.length >= limit) break;
  }
  return results;
}

function parseRss(xml, source, limit) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, limit).map((item) => {
    const publisher = item.match(/<source\b[^>]*url=["']([^"']+)["'][^>]*>([\s\S]*?)<\/source>/i);
    return {
      title: tag(item, "title"),
      url: normalizeUrl(tag(item, "link")),
      description: tag(item, "description"),
      published_at: tag(item, "pubDate") || undefined,
      publisher: publisher ? stripHtml(publisher[2]) : undefined,
      publisher_url: publisher ? normalizeUrl(publisher[1]) : undefined,
      source,
    };
  }).filter((r) => r.title && /^https?:\/\//i.test(r.url));
}

async function searchNews(searchQuery, relevanceQuery, limit, market, domains = []) {
  const cc = MARKET[market]?.cc || "US";
  const [google, bing] = await Promise.allSettled([
    fetchText("https://news.google.com/rss/search?q=" + encodeURIComponent(searchQuery) + "&hl=en-US&gl=" + cc + "&ceid=" + cc + ":en"),
    fetchText("https://www.bing.com/news/search?q=" + encodeURIComponent(searchQuery) + "&format=RSS"),
  ]);
  const out = [];
  if (google.status === "fulfilled") out.push(...parseRss(google.value, "google-news-rss", limit * 2));
  if (bing.status === "fulfilled") out.push(...parseRss(bing.value, "bing-news-rss", limit * 2));
  return postProcess(out, relevanceQuery, domains, limit);
}

async function cloudflareSearch(env, query, provider, limit) {
  if (!env.AI?.websearch) throw new Error("Cloudflare Web Search binding is unavailable.");
  const response = await env.AI.websearch({
    gatewayId: env.WEBSEARCH_GATEWAY_ID || "default",
    query,
    provider,
    limit: Math.min(limit, 10),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.errors?.[0]?.message || "Cloudflare Web Search failed.");
  return (body.items || []).map((item) => ({
    title: item.title || "",
    url: item.url || "",
    description: item.description || "",
    source: "cloudflare-" + provider,
  }));
}

export async function searchWeb(env, {
  query,
  mode = "web",
  market = "global",
  limit = 10,
  domains = [],
  backend = "free",
}) {
  const n = Math.max(1, Math.min(Number(limit) || 10, 20));
  const q = buildQuery(query, mode, market, domains);

  if (mode === "news") {
    const news = await searchNews(q, query, n, market, domains);
    return {
      query: q,
      backend: "free-news-rss",
      quality: news.quality,
      results: news.results,
    };
  }

  if (backend.startsWith("cloudflare-")) {
    if (env.ALLOW_PAID_WEBSEARCH !== "1") {
      throw new Error("Paid Cloudflare Web Search is disabled for this MCP. Free search remains available.");
    }
    const provider = backend.replace("cloudflare-", "");
    if (!["exa", "linkup", "ceramic"].includes(provider)) throw new Error("Unsupported Cloudflare provider.");
    const premium = postProcess(await cloudflareSearch(env, q, provider, n * 2), query, domains, n);
    return {
      query: q,
      backend,
      paid: true,
      quality: premium.quality,
      results: premium.results,
    };
  }

  const settled = await Promise.allSettled([
    searchDuckDuckGo(q, Math.min(n * 2, 20)),
    searchBing(q, Math.min(n * 2, 20), market),
  ]);

  let rawResults = [];
  const errors = [];
  for (const result of settled) {
    if (result.status === "fulfilled") rawResults.push(...result.value);
    else errors.push(String(result.reason?.message || result.reason));
  }

  let processed = postProcess(rawResults, query, domains, n);
  const fallbacksUsed = [];
  const minimumUseful = Math.min(3, n);
  const lowQuality = () =>
    processed.results.length < minimumUseful ||
    processed.quality.top_score < 0.34 ||
    processed.quality.average_top3 < 0.22;

  if (lowQuality()) {
    try {
      const lite = await searchDuckDuckGoLite(q, Math.min(n * 2, 20));
      rawResults.push(...lite);
      processed = postProcess(rawResults, query, domains, n);
      fallbacksUsed.push("duckduckgo-lite");
    } catch (error) {
      errors.push("duckduckgo-lite: " + String(error?.message || error));
    }
  }

  if (backend === "auto" && lowQuality() && env.ALLOW_PAID_WEBSEARCH === "1") {
    try {
      const premium = await cloudflareSearch(env, q, "ceramic", n * 2);
      processed = postProcess([...rawResults, ...premium], query, domains, n);
      return {
        query: q,
        backend: "auto:free+cloudflare-ceramic",
        paid_fallback_used: true,
        fallbacks_used: fallbacksUsed,
        quality: processed.quality,
        errors,
        results: processed.results,
      };
    } catch (error) {
      errors.push("paid fallback: " + String(error?.message || error));
    }
  }

  const response = {
    query: q,
    backend: backend === "auto" ? "auto:free" : "free",
    fallbacks_used: fallbacksUsed,
    quality: processed.quality,
    errors,
    results: processed.results,
  };

  if (backend === "auto") {
    response.auto = lowQuality()
      ? {
          escalated: false,
          reason: env.ALLOW_PAID_WEBSEARCH === "1"
            ? "paid_fallback_failed"
            : "paid_fallback_disabled",
        }
      : { escalated: false, reason: "free_quality_acceptable" };
  }

  return response;
}

export async function multiSearch(env, {
  queries,
  mode = "web",
  market = "global",
  limit_per_query = 6,
}) {
  const list = queries.filter(Boolean).slice(0, 6);
  const responses = await Promise.all(
    list.map((query) => searchWeb(env, {
      query,
      mode,
      market,
      limit: Math.max(1, Math.min(Number(limit_per_query) || 6, 10)),
      backend: "free",
    }))
  );
  const combined = dedupe(responses.flatMap((r) => r.results), Math.min(30, list.length * limit_per_query));
  return { queries: list, mode, market, results: combined, per_query: responses };
}

function isForbiddenHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.includes(":")) return true;
  if (/^127\./.test(h) || /^0\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d{1,3})\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (h === "metadata.google.internal" || h === "metadata" || h.endsWith(".metadata.google.internal")) return true;
  return false;
}

export function validatePublicUrl(raw) {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http/https URLs are allowed.");
  if (u.username || u.password) throw new Error("URLs with embedded credentials are not allowed.");
  if (isForbiddenHost(u.hostname)) throw new Error("Local, private, link-local, metadata, and IPv6 literal hosts are blocked.");
  return u.toString();
}

export async function fetchPage(env, { url, render_js = false, max_chars = 30000 }) {
  const safe = validatePublicUrl(url);
  const cap = Math.max(1000, Math.min(Number(max_chars) || 30000, 50000));

  if (render_js) {
    if (!env.BROWSER?.quickAction) throw new Error("Browser Run binding is unavailable.");
    const res = await env.BROWSER.quickAction("markdown", {
      url: safe,
      gotoOptions: { waitUntil: "networkidle2", timeout: 30000 },
    });
    const body = await res.json();
    if (!res.ok || body?.success === false) throw new Error(body?.error || "Browser Run failed.");
    const markdown = typeof body?.result === "string" ? body.result : JSON.stringify(body?.result ?? "");
    return { url: safe, renderer: "cloudflare-browser-run", content: markdown.slice(0, cap), truncated: markdown.length > cap };
  }

  const res = await fetch(safe, {
    redirect: "follow",
    headers: { "User-Agent": UA, "Accept": "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.5" },
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const finalUrl = validatePublicUrl(res.url || safe);
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (!/(text|html|json|xml|javascript)/.test(type)) throw new Error("Unsupported content type: " + type);
  const raw = await res.text();
  const text = type.includes("html") ? stripHtml(raw) : raw.trim();
  return { url: finalUrl, renderer: "direct-fetch", content_type: type, content: text.slice(0, cap), truncated: text.length > cap };
}

export async function githubSearch(env, { query, kind = "repositories", limit = 10 }) {
  const n = Math.max(1, Math.min(Number(limit) || 10, 20));
  const endpoint = kind === "issues" ? "issues" : kind === "code" ? "code" : "repositories";
  const url = "https://api.github.com/search/" + endpoint + "?q=" + encodeURIComponent(query) + "&per_page=" + n;
  const headers = {
    "User-Agent": UA,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = "Bearer " + env.GITHUB_TOKEN;
  const res = await fetch(url, { headers });
  const body = await res.json();
  if (!res.ok) {
    const hint = kind === "code" && !env.GITHUB_TOKEN
      ? " GitHub code search may require an optional GITHUB_TOKEN Worker secret."
      : "";
    throw new Error((body?.message || "GitHub search failed") + hint);
  }
  const items = (body.items || []).map((x) => ({
    name: x.full_name || x.name || x.title || x.path || "",
    url: x.html_url || x.repository?.html_url || "",
    description: x.description || x.body || x.text_matches?.[0]?.fragment || "",
    repository: x.repository?.full_name || x.repository_url?.split("/repos/")[1] || x.full_name || undefined,
    stars: x.stargazers_count,
    language: x.language,
    updated_at: x.updated_at,
  }));
  return { query, kind, total_count: body.total_count, results: items.slice(0, n) };
}

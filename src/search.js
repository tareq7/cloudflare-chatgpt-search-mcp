import { searchSearxng } from "./providers/searxng.js";
import { parseSearchRss } from "./parsers/rss.js";
import { parseDuckDuckGoHtml, parseDuckDuckGoLite, parseBingHtml } from "./parsers/search-html.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const PROVIDER_TIMEOUT_MS = 6000;
const MAX_PROVIDER_RESPONSE_BYTES = 1_500_000;

const MARKET = {
  global: { cc: "", label: "" },
  SA: { cc: "SA", label: "Saudi Arabia" },
  AE: { cc: "AE", label: "United Arab Emirates" },
  CN: { cc: "CN", label: "China" },
};

const LOCAL_FALLBACKS = {
  SA: {
    supplier: "السعودية مورد موزع مستودع مخزون محلي",
    commerce: "السعودية شراء سعر متجر",
  },
  AE: {
    supplier: "الإمارات دبي مورد موزع مستودع مخزون محلي",
    commerce: "الإمارات دبي شراء سعر متجر",
  },
  CN: {
    supplier: "中国 厂家 制造商 供应商 批发 OEM ODM",
    commerce: "中国 价格 批发 供应商",
  },
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
  let decoded = String(value);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {}

  if (/^https?:\/\//i.test(decoded)) return decoded;

  const candidates = [decoded];
  if (/^a\d/i.test(decoded)) candidates.unshift(decoded.slice(2));

  for (let encoded of candidates) {
    encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    encoded += "=".repeat((4 - (encoded.length % 4)) % 4);
    try {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const target = new TextDecoder().decode(bytes);
      if (/^https?:\/\//i.test(target)) return target;
    } catch {}
  }

  return "";
}

function normalizeUrl(raw, depth = 0) {
  if (!raw || depth > 3) return "";
  try {
    let value = decodeHtml(raw);
    if (value.startsWith("//")) value = "https:" + value;
    const u = new URL(value, "https://duckduckgo.com");
    const host = u.hostname.toLowerCase();

    if (host === "duckduckgo.com" || host.endsWith(".duckduckgo.com")) {
      if (u.pathname.startsWith("/l/")) {
        const target = u.searchParams.get("uddg");
        return target ? normalizeUrl(target, depth + 1) : "";
      }
      return "";
    }

    if (host === "bing.com" || host.endsWith(".bing.com")) {
      if (u.pathname.startsWith("/ck/")) {
        const target =
          decodeBingTarget(u.searchParams.get("u")) ||
          decodeBingTarget(u.searchParams.get("url")) ||
          decodeBingTarget(u.searchParams.get("r"));
        return target ? normalizeUrl(target, depth + 1) : "";
      }
      if (u.pathname.includes("/news/") || u.pathname.includes("apiclick")) {
        const rawTarget = u.searchParams.get("url") || u.searchParams.get("r");
        if (rawTarget) {
          const target = decodeBingTarget(rawTarget) || rawTarget;
          return normalizeUrl(target, depth + 1);
        }
      }
      return "";
    }

    if (host === "google.com" || host.endsWith(".google.com")) {
      if (u.pathname === "/url") {
        const target = u.searchParams.get("q") || u.searchParams.get("url");
        return target ? normalizeUrl(target, depth + 1) : "";
      }
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

function isGenericHomepage(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return !path || path === "/index.html" || path === "/home" || path === "/en" || path === "/login" || path === "/default.aspx";
  } catch {
    return false;
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

function termAppears(text, tokens, term) {
  if (tokens.has(term)) return true;
  const spaced = term.replace(/[._-]+/g, " ");
  if (spaced !== term && text.includes(spaced)) return true;
  return term.length >= 5 && text.includes(term);
}

function relevanceDetails(result, query) {
  const terms = queryTerms(query);
  if (!terms.length) return { score: 1, matches: 0 };

  const title = String(result.title || "").toLowerCase().normalize("NFKC");
  const description = String(result.description || "").toLowerCase().normalize("NFKC");
  const url = String(result.url || "").toLowerCase().normalize("NFKC");
  const titleTokens = new Set(queryTerms(title));
  const descriptionTokens = new Set(queryTerms(description));
  const urlTokens = new Set(queryTerms(url));

  let weighted = 0;
  let matches = 0;

  for (const term of terms) {
    if (termAppears(title, titleTokens, term)) {
      weighted += 3;
      matches += 1;
    } else if (termAppears(description, descriptionTokens, term)) {
      weighted += 1.5;
      matches += 1;
    } else if (termAppears(url, urlTokens, term)) {
      weighted += 0.75;
      matches += 1;
    }
  }

  return {
    score: Math.min(1, weighted / (terms.length * 3)),
    matches,
  };
}

function canonicalizeResult(result) {
  const url = normalizeUrl(result.url || "");
  if (!/^https?:\/\//i.test(url)) return null;

  const publisherUrl = result.publisher_url
    ? normalizeUrl(result.publisher_url)
    : "";

  const domain = hostOf(publisherUrl || url);
  if (!domain) return null;

  return {
    ...result,
    url,
    publisher_url: publisherUrl || undefined,
    domain,
  };
}

function dedupe(results, limit, perDomainLimit = 3, domains = []) {
  const seen = new Set();
  const perDomain = new Map();
  const out = [];

  for (const raw of results) {
    const result = canonicalizeResult(raw);
    if (!result || !matchesDomains(result, domains)) continue;

    const key = result.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;

    const count = perDomain.get(result.domain) || 0;
    if (count >= perDomainLimit) continue;

    seen.add(key);
    perDomain.set(result.domain, count + 1);
    out.push(result);
    if (out.length >= limit) break;
  }

  return out;
}

function postProcess(results, query, domains, limit) {
  const perDomainLimit = domains?.length ? Math.max(limit, 10) : 3;
  const terms = queryTerms(query);
  const termCount = terms.length;

  const canonical = dedupe(
    results,
    Math.max(limit * 6, 30),
    perDomainLimit,
    domains,
  ).map((result) => {
    const relevanceQuery = result._relevanceQuery || query;
    const relevance = relevanceDetails(result, relevanceQuery);
    const isHomepage = isGenericHomepage(result.url);
    const isClutterHomepage = isHomepage && termCount >= 2 && relevance.matches < 2;
    return {
      ...result,
      _score: isClutterHomepage ? 0 : relevance.score,
      _matches: isClutterHomepage ? 0 : relevance.matches,
      _isHomepage: isHomepage,
    };
  });

  const threshold = termCount <= 1 ? 0.2 : termCount <= 3 ? 0.18 : 0.14;
  const minimumMatches = termCount >= 4 ? 2 : termCount ? 1 : 0;
  let relevant = canonical
    .filter((result) =>
      result._score >= threshold && result._matches >= minimumMatches
    )
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  if (!relevant.length && canonical.length > 0) {
    const fallbackThreshold = termCount <= 1 ? 0.15 : termCount <= 3 ? 0.12 : 0.10;
    const fallbackMinMatches = termCount >= 4 ? 2 : termCount ? 1 : 0;
    relevant = canonical
      .filter((result) =>
        result._score >= fallbackThreshold &&
        result._matches >= fallbackMinMatches &&
        !result._isHomepage
      )
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
  }

  const topScore = relevant[0]?._score || 0;
  const avgTop3 = relevant.length
    ? relevant.slice(0, 3).reduce((sum, result) => sum + result._score, 0) /
      Math.min(3, relevant.length)
    : 0;

  return {
    results: relevant.map(({
      _score,
      _matches,
      _isHomepage,
      _relevanceQuery,
      ...result
    }) => result),
    quality: {
      top_score: Number(topScore.toFixed(3)),
      average_top3: Number(avgTop3.toFixed(3)),
      kept: relevant.length,
      candidates: canonical.length,
      discarded_low_relevance: Math.max(0, canonical.length - relevant.length),
    },
  };
}

function domainClause(domains = []) {
  const cleanDomains = domains.map(normalizeDomain).filter(Boolean).slice(0, 5);
  if (cleanDomains.length === 1) return " site:" + cleanDomains[0];
  if (cleanDomains.length > 1) {
    return " (" + cleanDomains.map((domain) => "site:" + domain).join(" OR ") + ")";
  }
  return "";
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

  return (q + domainClause(domains)).slice(0, 1000);
}

function buildMarketFallbackQuery(query, mode, market, domains = []) {
  const hint = LOCAL_FALLBACKS[market]?.[mode];
  if (!hint) return "";
  return (query.trim() + " " + hint + domainClause(domains)).slice(0, 1000);
}

async function readTextLimited(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Provider response exceeded " + maxBytes + " bytes.");
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error("Provider response exceeded " + maxBytes + " bytes.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Provider response exceeded " + maxBytes + " bytes.");
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

async function fetchText(url, init = {}, limits = {}) {
  const timeoutMs = Math.max(
    100,
    Number(limits.timeoutMs) || PROVIDER_TIMEOUT_MS,
  );
  const maxBytes = Math.max(
    1024,
    Number(limits.maxBytes) || MAX_PROVIDER_RESPONSE_BYTES,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      redirect: "follow",
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.8,ar;q=0.5",
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      throw new Error(
        "HTTP " + res.status + " from " + new URL(url).hostname,
      );
    }
    return await readTextLimited(res, maxBytes);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        "Timed out after " + timeoutMs + " ms from " + new URL(url).hostname,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function searchDuckDuckGo(query, limit) {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const html = await fetchText(url, { method: "GET" });
  const results = parseDuckDuckGoHtml(html, limit)
    .map((item) => ({ ...item, url: normalizeUrl(item.url) }))
    .filter((item) => item.url);

  if (!results.length && /result__a|result__snippet/i.test(html)) {
    throw new Error("DuckDuckGo parser found result markup but parsed zero results.");
  }
  return results;
}

async function searchDuckDuckGoLite(query, limit) {
  const url = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query);
  const html = await fetchText(url, { method: "GET" });
  return parseDuckDuckGoLite(html, limit)
    .map((item) => ({ ...item, url: normalizeUrl(item.url) }))
    .filter((item) => item.url);
}

function parseRss(xml, source, limit) {
  return parseSearchRss(xml, { source, limit }).map((result) => ({
    ...result,
    url: normalizeUrl(result.url),
    publisher_url: result.publisher_url
      ? normalizeUrl(result.publisher_url)
      : undefined,
  })).filter((result) => result.url);
}

async function searchBingRss(query, limit, market) {
  const p = new URLSearchParams({
    q: query,
    format: "rss",
    count: String(Math.min(limit + 4, 20)),
  });
  const cc = MARKET[market]?.cc;
  if (cc) p.set("cc", cc);
  p.set("setlang", "en");

  const xml = await fetchText("https://www.bing.com/search?" + p.toString());
  return parseRss(xml, "bing-rss", limit).map((result) => ({
    ...result,
    publisher: undefined,
    publisher_url: undefined,
  }));
}

async function searchBingHtml(query, limit, market) {
  const p = new URLSearchParams({
    q: query,
    count: String(Math.min(limit + 4, 20)),
  });
  const cc = MARKET[market]?.cc;
  if (cc) p.set("cc", cc);
  p.set("setlang", "en");

  const html = await fetchText("https://www.bing.com/search?" + p.toString());
  const results = parseBingHtml(html, limit)
    .map((item) => ({ ...item, url: normalizeUrl(item.url) }))
    .filter((item) => item.url);

  if (!results.length && /\bb_algo\b/i.test(html)) {
    throw new Error("Bing parser found result markup but parsed zero results.");
  }
  return results;
}

async function searchNews(env, searchQuery, relevanceQuery, limit, market, domains = []) {
  const cc = MARKET[market]?.cc || "US";
  const [google, bing] = await Promise.allSettled([
    fetchText(
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent(searchQuery) +
      "&hl=en-US&gl=" + cc + "&ceid=" + cc + ":en",
    ),
    fetchText(
      "https://www.bing.com/news/search?q=" +
      encodeURIComponent(searchQuery) +
      "&format=RSS",
    ),
  ]);

  const out = [];
  for (const [settled, source] of [
    [google, "google-news-rss"],
    [bing, "bing-news-rss"],
  ]) {
    if (settled.status !== "fulfilled") continue;
    try {
      out.push(...parseRss(settled.value, source, limit * 2));
    } catch {
      // A blocked, truncated, or malformed feed should never discard the
      // independent provider's valid news results.
    }
  }

  let processed = postProcess(out, relevanceQuery, domains, limit);

  if (processed.results.length === 0) {
    const newsFallbacks = [];
    const newsQuery = (relevanceQuery.trim() + " news" + domainClause(domains)).trim();

    if (env && (env.SEARXNG_URL || env.SEARXNG_URLS || env.SEARXNG_DEFAULT_URL || env.DEFAULT_SEARXNG_URL)) {
      try {
        const searxResults = await searchSearxng(env, {
          query: newsQuery,
          market,
          mode: "news",
          limit: limit * 2,
        });
        if (searxResults?.length) newsFallbacks.push(...searxResults);
      } catch {}
    }

    if (newsFallbacks.length === 0) {
      try {
        const ddgResults = await searchDuckDuckGo(newsQuery, limit * 2);
        if (ddgResults?.length) newsFallbacks.push(...ddgResults);
      } catch {}
    }

    if (newsFallbacks.length === 0) {
      try {
        const bingResults = await searchBingHtml(newsQuery, limit * 2, market);
        if (bingResults?.length) newsFallbacks.push(...bingResults);
      } catch {}
    }

    if (newsFallbacks.length === 0 && domains?.length > 0) {
      try {
        const broadNews = await searchDuckDuckGo((relevanceQuery.trim() + " news").trim(), limit * 3);
        if (broadNews?.length) newsFallbacks.push(...broadNews);
      } catch {}
    }

    if (newsFallbacks.length) {
      processed = postProcess(newsFallbacks, relevanceQuery, domains, limit);
    }
  }

  return processed;
}


async function collectSearches(searches, errors, prefix = "") {
  const settled = await Promise.allSettled(searches);
  const results = [];

  for (const item of settled) {
    if (item.status === "fulfilled") {
      results.push(...item.value);
    } else {
      errors.push(
        (prefix ? prefix + ": " : "") +
        String(item.reason?.message || item.reason),
      );
    }
  }

  return results;
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
  const cap = Math.min(n * 2, 20);
  const q = buildQuery(query, mode, market, domains);

  const searxngEnabled = Boolean(
    env.SEARXNG_URL || env.SEARXNG_URLS || env.SEARXNG_DEFAULT_URL || env.DEFAULT_SEARXNG_URL,
  );
  const searxngDiagnostics = { attempted: [], skipped: [], selected: null };
  const searxngUseful = (items) => {
    const quality = postProcess(items, query, domains, n);
    return quality.results.length >= Math.min(3, n) &&
      quality.quality.top_score >= 0.34 &&
      quality.quality.average_top3 >= 0.22;
  };

  if (backend === "searxng") {
    const matches = postProcess(
      await searchSearxng(env, {
        query: q, market, mode, limit: cap,
        isUseful: searxngUseful, diagnostics: searxngDiagnostics,
      }),
      query, domains, n,
    );
    return {
      query: q,
      search_queries: [q],
      backend: "searxng",
      searxng_chain: searxngDiagnostics,
      quality: matches.quality,
      results: matches.results,
    };
  }

  if (mode === "news") {
    const news = await searchNews(env, q, query, n, market, domains);
    return {
      query: q,
      search_queries: [q],
      backend: "free-news-rss",
      quality: news.quality,
      results: news.results,
    };
  }

  const errors = [];
  const fallbacksUsed = [];
  const fallbacksAttempted = [];
  const searchQueries = [q];
  const hasSearxng = searxngEnabled;
  const primarySearches = hasSearxng
    ? [searchSearxng(env, {
        query: q, market, mode, limit: cap,
        isUseful: searxngUseful, diagnostics: searxngDiagnostics,
      })]
    : [searchDuckDuckGo(q, cap)];
  if (!hasSearxng && env.ENABLE_BING_RSS === "1") {
    primarySearches.push(searchBingRss(q, cap, market));
  }
  let rawResults = await collectSearches(
    primarySearches,
    errors,
    "primary",
  );

  let processed = postProcess(rawResults, query, domains, n);
  const minimumUseful = Math.min(3, n);
  const lowQuality = () =>
    processed.results.length < minimumUseful ||
    processed.quality.top_score < 0.34 ||
    processed.quality.average_top3 < 0.22;

  // Keep established free providers as a fallback if upstream search is unhealthy or low quality.
  if (hasSearxng && lowQuality()) {
    fallbacksAttempted.push("duckduckgo");
    const ddg = await collectSearches(
      [searchDuckDuckGo(q, cap)], errors, "upstream-fallback",
    );
    if (ddg.length) {
      rawResults.push(...ddg);
      fallbacksUsed.push("duckduckgo");
      processed = postProcess(rawResults, query, domains, n);
    }
  }

  if (lowQuality()) {
    fallbacksAttempted.push("duckduckgo-lite", "bing-html");
    const fallbackResults = await collectSearches([
      searchDuckDuckGoLite(q, cap),
      searchBingHtml(q, cap, market),
    ], errors, "free-fallback");
    if (fallbackResults.length) {
      rawResults.push(...fallbackResults);
      const fallbackSources = new Set(
        fallbackResults.map((result) => result.source),
      );
      if (fallbackSources.has("duckduckgo-lite")) {
        fallbacksUsed.push("duckduckgo-lite");
      }
      if (fallbackSources.has("bing-html")) {
        fallbacksUsed.push("bing-html");
      }
      processed = postProcess(rawResults, query, domains, n);
    }
  }

  const marketQuery = buildMarketFallbackQuery(query, mode, market, domains);
  if (lowQuality() && marketQuery && marketQuery !== q) {
    fallbacksAttempted.push("market-localized");
    const marketSearches = [searchDuckDuckGo(marketQuery, cap)];
    if (env.ENABLE_BING_RSS === "1") {
      marketSearches.push(searchBingRss(marketQuery, cap, market));
    }
    const marketResults = await collectSearches(
      marketSearches,
      errors,
      "market-fallback",
    );

    searchQueries.push(marketQuery);
    if (marketResults.length) {
      rawResults.push(
        ...marketResults.map((result) => ({
          ...result,
          _relevanceQuery: marketQuery,
        })),
      );
      fallbacksUsed.push("market-localized");
      processed = postProcess(rawResults, query, domains, n);
    }
  }

  const cleanQuery = (query.trim() + domainClause(domains)).slice(0, 1000);
  if (lowQuality() && cleanQuery !== q && cleanQuery !== marketQuery) {
    fallbacksAttempted.push("clean-query");
    const cleanSearches = [searchDuckDuckGo(cleanQuery, cap), searchBingHtml(cleanQuery, cap, market)];
    const cleanResults = await collectSearches(
      cleanSearches,
      errors,
      "clean-fallback",
    );
    searchQueries.push(cleanQuery);
    if (cleanResults.length) {
      rawResults.push(...cleanResults);
      fallbacksUsed.push("clean-query");
      processed = postProcess(rawResults, query, domains, n);
    }
  }

  const uniqueFallbacks = [...new Set(fallbacksUsed)];
  const uniqueAttempts = [...new Set(fallbacksAttempted)];
  const stillLow = lowQuality();
  const response = {
    query: q,
    search_queries: searchQueries,
    backend: backend === "auto" && uniqueAttempts.length
      ? "auto:free-fallbacks"
      : backend === "auto"
        ? hasSearxng ? "auto:searxng" : "auto:free"
        : hasSearxng ? "free:searxng" : "free",
    fallbacks_used: uniqueFallbacks,
    fallbacks_attempted: uniqueAttempts,
    ...(hasSearxng ? { searxng_chain: searxngDiagnostics } : {}),
    quality: processed.quality,
    errors,
    results: processed.results,
  };

  if (backend === "auto") {
    response.auto = stillLow
      ? {
          escalated: uniqueAttempts.length > 0,
          reason: "free_fallbacks_exhausted",
        }
      : uniqueAttempts.length
        ? { escalated: true, reason: "free_fallback_recovered" }
        : { escalated: false, reason: "free_quality_acceptable" };
  }

  return response;
}

export async function multiSearch(env, {
  queries,
  mode = "web",
  market = "global",
  limit_per_query = 6,
  domains = [],
  backend = "auto",
}) {
  const list = [...new Set((queries || []).filter(Boolean).map((q) => String(q).trim()))]
    .filter(Boolean)
    .slice(0, 6);
  if (!list.length) {
    return {
      queries: [],
      mode,
      market,
      backend,
      quality: { top_score: 0, average_top3: 0, kept: 0, candidates: 0, discarded_low_relevance: 0 },
      fallbacks_used: [],
      fallbacks_attempted: [],
      errors: [],
      results: [],
      per_query: [],
    };
  }
  const perQueryLimit = Math.max(1, Math.min(Number(limit_per_query) || 6, 10));

  const runOne = async (query) => {
    try {
      return await searchWeb(env, {
        query,
        mode,
        market,
        limit: perQueryLimit,
        domains,
        backend,
      });
    } catch (error) {
      return {
        query,
        search_queries: [query],
        backend: "error",
        results: [],
        quality: { top_score: 0, average_top3: 0, kept: 0, candidates: 0, discarded_low_relevance: 0 },
        errors: [String(error?.message || error)],
      };
    }
  };

  const settled = await Promise.allSettled(list.map(runOne));
  const responses = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          query: list[i],
          search_queries: [list[i]],
          backend: "error",
          results: [],
          quality: { top_score: 0, average_top3: 0, kept: 0, candidates: 0, discarded_low_relevance: 0 },
          errors: [String(s.reason?.message || s.reason)],
        }
  );

  const perDomainLimit = domains?.length ? Math.max(perQueryLimit, 10) : 3;
  const combined = dedupe(
    responses.flatMap((response) => response.results || []),
    Math.min(30, list.length * perQueryLimit),
    perDomainLimit,
    domains,
  );

  const topScores = responses.map((r) => r.quality?.top_score || 0).filter(Boolean);
  const avgScores = responses.map((r) => r.quality?.average_top3 || 0).filter(Boolean);
  const activeBackend = responses.map((r) => r.backend).find((b) => b && b !== "error") || backend;

  return {
    queries: list,
    mode,
    market,
    backend: activeBackend,
    quality: {
      top_score: topScores.length ? Number(Math.max(...topScores).toFixed(3)) : 0,
      average_top3: avgScores.length
        ? Number((avgScores.reduce((a, b) => a + b, 0) / avgScores.length).toFixed(3))
        : 0,
      kept: combined.length,
      candidates: responses.reduce((acc, r) => acc + (r.quality?.candidates || 0), 0),
      discarded_low_relevance: responses.reduce((acc, r) => acc + (r.quality?.discarded_low_relevance || 0), 0),
    },
    fallbacks_used: [...new Set(responses.flatMap((r) => r.fallbacks_used || []))],
    fallbacks_attempted: [...new Set(responses.flatMap((r) => r.fallbacks_attempted || []))],
    errors: [...new Set(responses.flatMap((r) => r.errors || []))],
    results: combined,
    per_query: responses,
  };
}

function isForbiddenHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !h ||
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) return true;
  if (h === "::1" || h.includes(":")) return true;
  if (
    /^127\./.test(h) ||
    /^0\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h)
  ) return true;
  const m = h.match(/^172\.(\d{1,3})\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (
    h === "metadata.google.internal" ||
    h === "metadata" ||
    h.endsWith(".metadata.google.internal")
  ) return true;
  return false;
}

export function validatePublicUrl(raw) {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Only http/https URLs are allowed.");
  }
  if (u.username || u.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }
  if (isForbiddenHost(u.hostname)) {
    throw new Error(
      "Local, private, link-local, metadata, and IPv6 literal hosts are blocked.",
    );
  }
  return u.toString();
}

export async function fetchPage(env, {
  url,
  render_js = false,
  max_chars = 30000,
}) {
  const safe = validatePublicUrl(url);
  const cap = Math.max(1000, Math.min(Number(max_chars) || 30000, 50000));

  if (render_js) {
    if (!env.BROWSER?.quickAction) {
      throw new Error("Browser Run binding is unavailable.");
    }
    const res = await env.BROWSER.quickAction("markdown", {
      url: safe,
      gotoOptions: { waitUntil: "networkidle2", timeout: 30000 },
    });
    const body = await res.json();
    if (!res.ok || body?.success === false) {
      throw new Error(body?.error || "Browser Run failed.");
    }
    const markdown = typeof body?.result === "string"
      ? body.result
      : JSON.stringify(body?.result ?? "");
    return {
      url: safe,
      renderer: "cloudflare-browser-run",
      content: markdown.slice(0, cap),
      truncated: markdown.length > cap,
    };
  }

  const res = await fetch(safe, {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.5",
    },
  });
  if (!res.ok) throw new Error("HTTP " + res.status);

  const finalUrl = validatePublicUrl(res.url || safe);
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (!/(text|html|json|xml|javascript)/.test(type)) {
    throw new Error("Unsupported content type: " + type);
  }

  const raw = await res.text();
  const text = type.includes("html") ? stripHtml(raw) : raw.trim();
  return {
    url: finalUrl,
    renderer: "direct-fetch",
    content_type: type,
    content: text.slice(0, cap),
    truncated: text.length > cap,
  };
}

export async function githubSearch(env, {
  query,
  kind = "repositories",
  limit = 10,
}) {
  const n = Math.max(1, Math.min(Number(limit) || 10, 20));
  const endpoint = kind === "issues"
    ? "issues"
    : kind === "code"
      ? "code"
      : "repositories";
  const url =
    "https://api.github.com/search/" +
    endpoint +
    "?q=" + encodeURIComponent(query) +
    "&per_page=" + n;

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

  const items = (body.items || []).map((item) => ({
    name: item.full_name || item.name || item.title || item.path || "",
    url: item.html_url || item.repository?.html_url || "",
    description:
      item.description ||
      item.body ||
      item.text_matches?.[0]?.fragment ||
      "",
    repository:
      item.repository?.full_name ||
      item.repository_url?.split("/repos/")[1] ||
      item.full_name ||
      undefined,
    stars: item.stargazers_count,
    language: item.language,
    updated_at: item.updated_at,
  }));

  return {
    query,
    kind,
    total_count: body.total_count,
    results: items.slice(0, n),
  };
}

export const __test = {
  buildMarketFallbackQuery,
  fetchText,
  decodeBingTarget,
  normalizeUrl,
  matchesDomains,
  relevanceDetails,
  postProcess,
};

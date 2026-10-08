const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_TIMEOUT_MS = 6000;

export async function searchBrave(env, {
  query,
  limit = 10,
  market = "global",
  diagnostics = null,
} = {}) {
  const token = env.BRAVE_API_KEY || env.BRAVE_SEARCH_API_KEY;
  if (!token) {
    throw new Error("Brave Search API key not configured. Set BRAVE_API_KEY in worker secrets.");
  }

  const count = Math.min(20, Math.max(1, Number(limit) || 10));
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  if (market === "SA") {
    url.searchParams.set("country", "SA");
    url.searchParams.set("search_lang", "ar,en");
  } else if (market === "AE") {
    url.searchParams.set("country", "AE");
    url.searchParams.set("search_lang", "ar,en");
  } else if (market === "CN") {
    url.searchParams.set("country", "CN");
    url.searchParams.set("search_lang", "zh,en");
  }

  const timeoutMs = Math.max(1000, Math.min(Number(env.BRAVE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 10000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": token.trim(),
        "User-Agent": "CloudflareSearchMCP/1.0",
      },
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Brave Search API token invalid or unauthorized (HTTP ${res.status}).`);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after") || "60";
      throw new Error(`Brave Search API rate limit exceeded (HTTP 429). Retry after ${retryAfter}s.`);
    }

    if (!res.ok) {
      throw new Error(`Brave Search API returned HTTP ${res.status}`);
    }

    const data = await res.json();
    const webResults = Array.isArray(data.web?.results) ? data.web.results : [];

    return webResults
      .filter((row) => row && typeof row.title === "string" && typeof row.url === "string" && /^https?:\/\//i.test(row.url))
      .map((row) => {
        let snippet = String(row.description || "");
        if (Array.isArray(row.extra_snippets) && row.extra_snippets.length > 0) {
          const extra = row.extra_snippets.filter(Boolean).join(" ");
          if (extra.length > snippet.length) {
            snippet = extra;
          }
        }
        return {
          title: row.title,
          url: row.url,
          description: snippet.slice(0, 1200),
          source: "brave",
        };
      });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Brave Search timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_TIMEOUT_MS = 7000;

export async function searchExa(env, {
  query,
  limit = 10,
  market = "global",
  mode = "web",
  domains = [],
  diagnostics = null,
} = {}) {
  const token = env.EXA_API_KEY || env.EXA_SEARCH_API_KEY;
  if (!token) {
    throw new Error("Exa API key not configured. Set EXA_API_KEY in worker secrets.");
  }

  const count = Math.min(25, Math.max(1, Number(limit) || 10));
  const payload = {
    query: String(query || "").trim(),
    type: "auto",
    numResults: count,
    contents: {
      text: { maxCharacters: 1200 },
    },
  };

  if (Array.isArray(domains) && domains.length > 0) {
    const cleanDomains = domains
      .map((d) => String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])
      .filter(Boolean);
    if (cleanDomains.length > 0) {
      payload.includeDomains = cleanDomains.slice(0, 10);
    }
  }

  if (mode === "news") {
    payload.category = "news";
  }

  const timeoutMs = Math.max(1000, Math.min(Number(env.EXA_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 12000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "x-api-key": token.trim(),
        "User-Agent": "CloudflareSearchMCP/1.0",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Exa API token invalid or unauthorized (HTTP ${res.status}).`);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after") || "60";
      throw new Error(`Exa API rate limit exceeded (HTTP 429). Retry after ${retryAfter}s.`);
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Exa API returned HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
    }

    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];

    return results
      .filter((row) => {
        if (!row || typeof row.url !== "string" || !/^https?:\/\//i.test(row.url)) return false;
        try {
          const u = new URL(row.url);
          const h = u.hostname.toLowerCase();
          if (h === "exa.ai" || h.endsWith(".exa.ai")) return false;
        } catch {
          return false;
        }
        return true;
      })
      .map((row) => {
        let snippet = String(row.text || row.snippet || row.description || "");
        if (Array.isArray(row.highlights) && row.highlights.length > 0) {
          const joinedHighlights = row.highlights.filter(Boolean).join(" ");
          if (joinedHighlights.length > snippet.length) {
            snippet = joinedHighlights;
          }
        }
        return {
          title: String(row.title || row.url).slice(0, 300),
          url: row.url,
          description: snippet.slice(0, 1500),
          source: "exa",
          published_at: row.publishedDate || undefined,
        };
      });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Exa Search timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Thin transport adapter for the independently hosted AGPL-3.0 SearXNG service.
// API specification: https://docs.searxng.org/dev/search_api.html
const TIMEOUT_MS = 8000;
const BODY_LIMIT = 600_000;
const LANGUAGES = { SA: "ar-SA", AE: "ar-AE", CN: "zh-CN", global: "en-US" };

function endpointFromEnv(env) {
  if (!env.SEARXNG_URL) {
    throw new Error("SEARXNG_URL is not configured.");
  }
  let url;
  try {
    url = new URL(env.SEARXNG_URL);
  } catch {
    throw new Error("SEARXNG_URL must be a valid HTTPS URL.");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" || url.username || url.password ||
    host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    host.startsWith("127.") || host.startsWith("10.") ||
    host.startsWith("192.168.") || host.startsWith("169.254.") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":") ||
    url.search || url.hash
  ) {
    throw new Error("SearXNG must use a public HTTPS instance URL without credentials, query, or fragment.");
  }
  const root = new URL(url.href.endsWith("/") ? url.href : url.href + "/");
  return new URL("search", root);
}

async function readJsonLimited(res, controller) {
  if (!res.ok) throw new Error("SearXNG HTTP " + res.status);
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("json")) {
    throw new Error("SearXNG must return JSON: enable search.formats: [html, json].");
  }
  const declared = Number(res.headers.get("content-length") || "0");
  if (declared > BODY_LIMIT) throw new Error("SearXNG response exceeded size limit.");
  const reader = res.body?.getReader();
  if (!reader) {
    const body = await res.text();
    if (new TextEncoder().encode(body).length > BODY_LIMIT) {
      throw new Error("SearXNG response exceeded size limit.");
    }
    return JSON.parse(body);
  }
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > BODY_LIMIT) {
        controller.abort();
        throw new Error("SearXNG response exceeded size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(result));
}

export async function searchSearxng(env, {
  query,
  market = "global",
  mode = "web",
  limit = 10,
}) {
  const url = endpointFromEnv(env);
  url.searchParams.set("q", String(query).slice(0, 1000));
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", mode === "news" ? "news" : "general");
  url.searchParams.set("language", LANGUAGES[market] || LANGUAGES.global);
  url.searchParams.set("safesearch", "0");
  const headers = { "Accept": "application/json" };
  // Optional reverse proxy / zero-trust credential stored only as a Worker secret.
  if (env.SEARXNG_BEARER_TOKEN) {
    headers.Authorization = "Bearer " + env.SEARXNG_BEARER_TOKEN;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    const json = await readJsonLimited(response, controller);
    if (!Array.isArray(json?.results)) {
      throw new Error("SearXNG JSON response has no results array.");
    }
    return json.results.slice(0, Math.min(Math.max(1, limit * 3), 40))
      .filter((row) =>
        row && typeof row.title === "string" && typeof row.url === "string" &&
        /^https?:\/\//i.test(row.url)
      )
      .map((row) => ({
        title: row.title,
        url: row.url,
        description: String(row.content || "").slice(0, 1200),
        source: "searxng",
        engines: Array.isArray(row.engines) ? row.engines.slice(0, 8) : [],
        published_at: row.publishedDate || undefined,
      }));
  } catch (error) {
    if (controller.signal.aborted && error?.message !== "SearXNG response exceeded size limit.") {
      throw new Error("SearXNG timed out after " + TIMEOUT_MS + " ms.");
    }
    if (error instanceof SyntaxError) throw new Error("SearXNG returned invalid JSON.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

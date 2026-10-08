// SearXNG JSON transport adapter: https://docs.searxng.org/dev/search_api.html
// The upstream SearXNG server is AGPL-3.0 and runs independently of this Worker.
//
// Public-instance safety:
// - explicit configuration only; no unapproved built-in public service pool
// - serial, bounded failover; no fan-out, no retries against the same server
// - no rotation after 401, 403 or 429 (respect access rules and rate limits)
// - a primary origin's bearer token is never sent to a different instance
const MAX_RESPONSE_BYTES = 600_000;
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 5500;
const LANGUAGES = { SA: "ar-SA", AE: "ar-AE", CN: "zh-CN", global: "en-US" };

// Best-effort isolate-level cooldown. Workers isolates do not share this map.
// This reduces repeat failures, but is not an account-wide rate limiter.
const cooldowns = new Map();
const COOLDOWN_MS = 5 * 60_000;
const DENIAL_COOLDOWN_MS = 30 * 60_000;

function validateEndpoint(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("SEARXNG endpoint must be a valid public HTTPS URL.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ip = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const badIp = ip && (
    ip.some((n) => Number(n) > 255) ||
    Number(ip[1]) === 0 || Number(ip[1]) === 10 || Number(ip[1]) === 127 ||
    Number(ip[1]) >= 224 ||
    Number(ip[1]) === 169 && Number(ip[2]) === 254 ||
    Number(ip[1]) === 172 && Number(ip[2]) >= 16 && Number(ip[2]) <= 31 ||
    Number(ip[1]) === 192 && Number(ip[2]) === 168 ||
    Number(ip[1]) === 100 && Number(ip[2]) >= 64 && Number(ip[2]) <= 127
  );
  if (
    url.protocol !== "https:" ||
    url.username || url.password || url.search || url.hash ||
    (url.port && url.port !== "443") ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".invalid") ||
    hostname.includes(":") || ip || badIp
  ) {
    throw new Error("SearXNG requires a public HTTPS hostname without URL credentials or private addresses.");
  }
  const root = new URL(url.pathname.endsWith("/") ? url.href : url.href + "/");
  return { origin: url.origin, url: new URL("search", root) };
}

export function configuredSearxngEndpoints(env = {}) {
  const raw = [];
  if (env.SEARXNG_URL) raw.push(String(env.SEARXNG_URL).trim());
  if (env.SEARXNG_URLS) {
    raw.push(...String(env.SEARXNG_URLS).split(/[\n,;]+/).map(s => s.trim()));
  }
  const endpoints = [];
  const seen = new Set();
  for (const entry of raw.filter(Boolean)) {
    const endpoint = validateEndpoint(entry);
    const key = endpoint.url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    endpoints.push(endpoint);
    if (endpoints.length >= 8) break;
  }
  if (!endpoints.length) {
    throw new Error("SEARXNG_URL or SEARXNG_URLS is not configured.");
  }
  if (env.SEARXNG_BEARER_TOKEN && !env.SEARXNG_URL) {
    throw new Error("SEARXNG_BEARER_TOKEN requires a primary SEARXNG_URL so it cannot leak to backup hosts.");
  }
  return endpoints;
}

async function readJsonLimited(res, controller) {
  if (!res.ok) {
    const error = new Error("SearXNG HTTP " + res.status);
    error.status = res.status;
    throw error;
  }
  if (!(res.headers.get("content-type") || "").toLowerCase().includes("json")) {
    throw new Error("SearXNG did not return JSON; this instance may not enable format=json.");
  }
  const length = Number(res.headers.get("content-length") || "0");
  if (length > MAX_RESPONSE_BYTES) throw new Error("SearXNG response exceeded size limit.");
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) {
      throw new Error("SearXNG response exceeded size limit.");
    }
    return JSON.parse(text);
  }
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
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
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(result));
}

function errorLabel(error) {
  if (error?.status) return "HTTP " + error.status;
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "timeout";
  if (error instanceof SyntaxError) return "invalid JSON";
  return String(error?.message || error).slice(0, 150);
}

function cooldown(origin, ms) {
  if (cooldowns.size >= 32) cooldowns.delete(cooldowns.keys().next().value);
  cooldowns.set(origin, Date.now() + ms);
}

async function searchOne(env, endpoint, args, authOrigin, timeoutMs) {
  const url = new URL(endpoint.url);
  url.searchParams.set("q", String(args.query).slice(0, 1000));
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", args.mode === "news" ? "news" : "general");
  url.searchParams.set("language", LANGUAGES[args.market] || LANGUAGES.global);
  url.searchParams.set("safesearch", "0");

  const headers = { Accept: "application/json" };
  if (env.SEARXNG_BEARER_TOKEN && endpoint.origin === authOrigin) {
    headers.Authorization = "Bearer " + env.SEARXNG_BEARER_TOKEN;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    return json.results
      .slice(0, Math.min(Math.max(1, args.limit * 3), 40))
      .filter((row) => row && typeof row.title === "string" &&
        typeof row.url === "string" && /^https?:\/\//i.test(row.url))
      .map((row) => ({
        title: row.title,
        url: row.url,
        description: String(row.content || "").slice(0, 1200),
        source: "searxng",
        source_instance: endpoint.origin,
        engines: Array.isArray(row.engines) ? row.engines.slice(0, 8) : [],
        published_at: row.publishedDate || undefined,
      }));
  } catch (error) {
    if (controller.signal.aborted && error?.message !== "SearXNG response exceeded size limit.") {
      throw new Error("SearXNG timed out after " + timeoutMs + " ms.");
    }
    if (error instanceof SyntaxError) throw new Error("SearXNG returned invalid JSON.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchSearxng(env, {
  query,
  market = "global",
  mode = "web",
  limit = 10,
  isUseful,
  diagnostics,
} = {}) {
  const endpoints = configuredSearxngEndpoints(env);
  const authOrigin = env.SEARXNG_URL ? validateEndpoint(env.SEARXNG_URL).origin : null;
  const attempts = Math.max(1, Math.min(
    Number(env.SEARXNG_MAX_ATTEMPTS) || 2, MAX_ATTEMPTS,
  ));
  const timeoutMs = Math.max(1000, Math.min(
    Number(env.SEARXNG_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 8000,
  ));
  const failures = [];
  let used = 0;
  for (const endpoint of endpoints) {
    if (used >= attempts) break;
    const until = cooldowns.get(endpoint.origin) || 0;
    if (until > Date.now()) {
      diagnostics?.skipped?.push(endpoint.origin);
      continue;
    }
    used += 1;
    diagnostics?.attempted?.push(endpoint.origin);
    try {
      const results = await searchOne(
        env, endpoint, { query, market, mode, limit }, authOrigin, timeoutMs,
      );
      if (results.length && (!isUseful || isUseful(results))) {
        if (diagnostics) diagnostics.selected = endpoint.origin;
        return results;
      }
      // A valid response can be irrelevant to one niche or domain-restricted query.
      // Do not penalize the host for future unrelated searches.
      failures.push(endpoint.origin + ": empty or low-relevance results");
    } catch (error) {
      failures.push(endpoint.origin + ": " + errorLabel(error));
      if ([401, 403, 429].includes(error?.status)) {
        cooldown(endpoint.origin, DENIAL_COOLDOWN_MS);
        // Never move to another public host to circumvent a denial/rate limit.
        throw new Error("SearXNG access or rate-limit denial: " + failures.at(-1));
      }
      cooldown(endpoint.origin, COOLDOWN_MS);
    }
  }
  throw new Error("SearXNG hosts unavailable: " + (failures.join("; ") || "all hosts in cooldown"));
}

// Exposed only to regression tests so cooldowns do not leak between tests.
export function __clearSearxngCooldownsForTests() {
  cooldowns.clear();
}

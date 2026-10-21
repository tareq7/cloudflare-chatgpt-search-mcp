// Gemini 3.8 Flash Google Search grounding. Explicit paid opt-in; NEVER called by ordinary search.
const MODEL = "gemini-3.8-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent";
const MAX_DAILY_REQUESTS = 2;
const MAX_MONTHLY_REQUESTS = 10;
const MAX_OUTPUT_TOKENS = 768;
const RESERVATION_USD = 0.01; // Advisory worst-case budget reservation per call, NOT a billing ceiling.
let lastIssuedAt = 0;
let activeRequest = false;
// The deployment origin is configured per Worker, never derived from untrusted request headers.
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

function renderGroundedView(answer, sources, supports, suggestions) {
  const references = sources.map((s, i) =>
    '<li><a rel="noopener noreferrer" href="' + escapeHtml(s.url) + '">' +
    escapeHtml(s.title || s.url) + "</a></li>"
  ).join("");
  let annotated = escapeHtml(answer);
  // Attach citations where Gemini supplies matching support text.
  for (const support of [...supports].reverse()) {
    const quote = support?.segment?.text;
    const positions = (support?.groundingChunkIndices || []).filter((i) => Number.isInteger(i) && sources[i]);
    if (!quote || !positions.length) continue;
    const needle = escapeHtml(quote);
    const pos = annotated.lastIndexOf(needle);
    if (pos < 0) continue;
    const links = positions.map((i) =>
      '<a href="' + escapeHtml(sources[i].url) + '" rel="noopener noreferrer">[' + (i + 1) + "]</a>"
    ).join(" ");
    annotated = annotated.slice(0, pos + needle.length) + " " + links + annotated.slice(pos + needle.length);
  }
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Google-grounded response</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:830px;margin:4rem auto;padding:0 20px;color:#202124}main{white-space:pre-wrap}li{margin:.4rem 0}a{color:#1558b0}</style></head><body>' +
    '<h1>Google-grounded response</h1><main>' + annotated + '</main>' +
    '<h2>Google Search suggestions</h2>' + suggestions +
    '<h2>Supporting sources</h2><ol>' + references + '</ol></body></html>';
}

export function assertGeminiSpendPolicy(env) {
  if (env.GEMINI_ZERO_SPEND_LOCK !== "0" ||
      env.GEMINI_OUTBOUND_ENABLED !== "1" ||
      env.GEMINI_GROUNDING_ENABLED !== "1" ||
      env.GEMINI_API_KEY_TIER !== "paid" ||
      !env.GEMINI_API_KEY || !env.OAUTH_KV || !env.GROUNDING_PUBLIC_ORIGIN ||
      !/^https:\/\//i.test(env.GROUNDING_PUBLIC_ORIGIN) ||
      !(Number(env.GEMINI_SPEND_LIMIT_USD) > 0) ||
      Number(env.GEMINI_SPEND_LIMIT_USD) > 0.10) {
    throw new Error("Gemini paid grounding disabled by policy; no outbound API request sent.");
  }
}

export async function reserveRequest(env, query) {
  assertGeminiSpendPolicy(env);
  if (typeof query !== "string" || query.trim().length < 3 || query.length > 350) {
    throw new Error("Gemini request length must be 3–350 characters.");
  }
  if (await env.OAUTH_KV.get("gemini:paid:billing-block")) {
    throw new Error("Gemini paid-project prepayment is depleted (HTTP 402); blocked for 24 hours. Free search remains available.");
  }
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const dayKey = "gemini:paid:day:" + today;
  const monthKey = "gemini:paid:month:" + month;
  const budgetKey = "gemini:paid:budget:" + month;
  const [dayUsed, monthUsed, budgetUsed] = await Promise.all([
    env.OAUTH_KV.get(dayKey), env.OAUTH_KV.get(monthKey), env.OAUTH_KV.get(budgetKey)
  ]);
  const d = Number(dayUsed || 0);
  const m = Number(monthUsed || 0);
  const b = Number(budgetUsed || 0);
  if (!Number.isFinite(d + m + b) || d >= MAX_DAILY_REQUESTS ||
      m >= MAX_MONTHLY_REQUESTS ||
      b + RESERVATION_USD > Number(env.GEMINI_SPEND_LIMIT_USD) + 0.000001) {
    throw new Error("Local paid-Gemini advisory request or cost budget reached; use free search.");
  }
  // Reserve BEFORE calling Google. KV consistency is eventual; caps are not atomic/global.
  await Promise.all([
    env.OAUTH_KV.put(dayKey, String(d + 1), { expirationTtl: 172800 }),
    env.OAUTH_KV.put(monthKey, String(m + 1), { expirationTtl: 3456000 }),
    env.OAUTH_KV.put(budgetKey, String(Number((b + RESERVATION_USD).toFixed(4))), { expirationTtl: 3456000 })
  ]);
  return {
    day_used: d + 1, day_limit: MAX_DAILY_REQUESTS,
    month_used: m + 1, month_limit: MAX_MONTHLY_REQUESTS,
    advisory_reserved_usd: Number((b + RESERVATION_USD).toFixed(4)),
    advisory_budget_usd: Number(env.GEMINI_SPEND_LIMIT_USD),
    enforcement: "best-effort KV; billing cap may lag, no hard charge guarantee"
  };
}

export async function googleGroundedSearch(env, { query }) {
  assertGeminiSpendPolicy(env);
  if (activeRequest || Date.now() - lastIssuedAt < 120000) {
    throw new Error("Gemini local cooldown or in-flight request; use free search or retry later.");
  }
  activeRequest = true;
  try {
    const budget = await reserveRequest(env, query);
    lastIssuedAt = Date.now();
    return await executeGroundedRequest(env, query, budget);
  } finally {
    activeRequest = false;
  }
}

async function executeGroundedRequest(env, query, budget) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Answer briefly and accurately using Google Search evidence. Query: " + query }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.1, thinkingConfig: { thinkingLevel: "low" } },
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    if (response.status === 402) {
      await env.OAUTH_KV.put("gemini:paid:billing-block", "402", { expirationTtl: 86400 });
      throw new Error("Gemini prepayment credits depleted (HTTP 402); blocked further Gemini calls for 24 hours. No auto-reload or billing change was made.");
    }
    if (response.status === 429) throw new Error("Gemini quota/rate limit reached; no retries or paid fallback.");
    const upstreamError = await response.json().catch(() => ({}));
    const detail = String(upstreamError?.error?.message || upstreamError?.error?.status || "")
      .replaceAll(env.GEMINI_API_KEY, "[redacted]").slice(0, 450);
    throw new Error("Gemini grounded API HTTP " + response.status +
      (detail ? ": " + detail : "") + "; no paid fallback.");
  }
  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const grounding = candidate?.groundingMetadata || {};
  const answer = (candidate?.content?.parts || []).map((p) => p.text || "").join("").trim();
  const sources = (grounding.groundingChunks || [])
    .map((chunk) => ({ title: chunk?.web?.title || "", url: chunk?.web?.uri || "" }))
    .filter((source) => /^https:\/\//i.test(source.url));
  const suggestions = grounding?.searchEntryPoint?.renderedContent || "";
  if (!answer || !sources.length || !suggestions)
    throw new Error("Google returned no complete grounded answer, citations, or required Search Suggestions.");
  const supports = grounding.groundingSupports || [];
  const token = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const page = renderGroundedView(answer, sources, supports, suggestions);
  await env.OAUTH_KV.put("gemini:grounded:view:" + token, page, { expirationTtl: 600 });
  return {
    backend: "gemini-3.8-flash-google-search", model: MODEL, grounded: true,
    query, answer, sources, grounding_supports: supports,
    google_search_queries: grounding.webSearchQueries || [],
    view_url: new URL(env.GROUNDING_PUBLIC_ORIGIN).origin + "/grounded/" + token,
    view_expires_seconds: 600, local_quota: budget,
    display_requirement: "Display the grounded response WITH Google's unmodified Search Suggestions at view_url.",
  };
}

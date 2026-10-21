// Gemini 2.5 Flash grounded answers. Requires an independently verified, unbilled free-tier project.
const MODEL = "gemini-2.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent";
const DAILY_BUDGET = 400; // Conservative advisory cap. Google's unbilled project quota is authoritative.
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

async function reserveRequest(env) {
  if (env.GEMINI_GROUNDING_ENABLED !== "1" ||
      env.GEMINI_FREE_TIER_CONFIRMED !== "1" ||
      !env.GEMINI_API_KEY || !env.OAUTH_KV || !env.GROUNDING_PUBLIC_ORIGIN ||
      !/^https:\/\//i.test(env.GROUNDING_PUBLIC_ORIGIN)) {
    throw new Error("Gemini grounding disabled: requires a verified unbilled free-tier API key and KV binding.");
  }
  const day = new Date().toISOString().slice(0, 10);
  const key = "gemini:free:grounding:" + day;
  const used = Number(await env.OAUTH_KV.get(key) || 0);
  if (used >= DAILY_BUDGET) throw new Error("Local Gemini free-tier safety budget reached; no paid fallback.");
  await env.OAUTH_KV.put(key, String(used + 1), { expirationTtl: 172800 });
  return { used: used + 1, budget: DAILY_BUDGET, advisory: true };
}

export async function googleGroundedSearch(env, { query }) {
  const budget = await reserveRequest(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    if (response.status === 429) throw new Error("Gemini free-tier rate limit or daily quota reached; no paid fallback.");
    throw new Error("Gemini grounded API HTTP " + response.status + "; no paid fallback.");
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
    backend: "gemini-2.5-flash-google-search", model: MODEL, grounded: true,
    query, answer, sources, grounding_supports: supports,
    google_search_queries: grounding.webSearchQueries || [],
    view_url: new URL(env.GROUNDING_PUBLIC_ORIGIN).origin + "/grounded/" + token,
    view_expires_seconds: 600, local_quota: budget,
    display_requirement: "Display the grounded response WITH Google's unmodified Search Suggestions at view_url.",
  };
}

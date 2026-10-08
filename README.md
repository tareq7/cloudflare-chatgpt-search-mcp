# Cloudflare ChatGPT Search MCP

A remote, read-only Model Context Protocol (MCP) search server designed to run on **Cloudflare Workers** and connect to **ChatGPT web** over Streamable HTTP.

## Features

- OAuth 2.1 + PKCE using Cloudflare's Workers OAuth Provider
- ChatGPT CIMD allowlist: the authorization endpoint only accepts ChatGPT client metadata documents
- Free web search using DuckDuckGo HTML, with DuckDuckGo Lite and canonicalized Bing HTML as quality fallbacks; Bing web RSS is available as an explicit opt-in
- Canonical URL resolution for DuckDuckGo and Bing tracking redirects before filtering and attribution
- Strict post-retrieval domain filtering, including subdomains of requested domains
- Lightweight lexical relevance scoring/gating to suppress malformed or off-topic SERP results
- Adaptive `backend: "auto"` behavior with free fallback escalation, market-aware Arabic/Chinese sourcing queries, explicit attempted/used fallback diagnostics, and optional paid Cloudflare Web Search escalation
- News search using Google News RSS and Bing News RSS with publisher-domain filtering
- Multi-query search with URL deduplication and domain diversity
- Public-page extraction with SSRF protections
- JavaScript rendering through Cloudflare Browser Run
- GitHub repository, issue/PR, and code search
- Optional Cloudflare AI Web Search fallback, disabled by default
- Deterministic regression tests for supplier, commerce, technical, domain-filter, and redirect-canonicalization failures
- Read-only MCP tools

## MCP tools

| Tool | Purpose |
| --- | --- |
| `search` | General web, news, supplier, commerce, and technical search |
| `multi_search` | Run several search angles concurrently and merge results |
| `fetch_page` | Extract a public URL directly or with Browser Run |
| `github_search` | Search GitHub repositories, issues/PRs, or code |

## Security model

The server is intentionally read-only. The `fetch_page` tool rejects localhost, RFC1918/private IPv4 ranges, link-local hosts, cloud metadata hosts, embedded URL credentials, and IPv6 literals. The Worker also enables Cloudflare's `global_fetch_strictly_public` compatibility flag.

OAuth authorization is restricted to ChatGPT CIMD client IDs under `https://chatgpt.com/oauth/.../client.json`.

No account IDs, API keys, OAuth tokens, Worker secrets, or production namespace IDs are included in this repository.

## Deploy on Cloudflare

### 1. Install dependencies

```bash
npm install
```

### 2. Create the OAuth KV namespace

```bash
npx wrangler kv namespace create OAUTH_KV
```

Copy the returned namespace ID into `wrangler.jsonc`, replacing:

```text
00000000000000000000000000000000
```

### 3. Deploy once to obtain your Worker hostname

```bash
npm run deploy
```

Wrangler will show a URL similar to:

```text
https://cloudflare-chatgpt-search-mcp.<your-subdomain>.workers.dev
```

### 4. Set the public origin

Edit `src/index.js` and replace:

```js
const ORIGIN = "https://your-worker.your-subdomain.workers.dev";
```

with the Worker URL from the previous step, then deploy again:

```bash
npm run deploy
```

### 5. Optional: authenticated GitHub code search

Repository and issue search can work without a GitHub credential, subject to GitHub's unauthenticated API limits. For higher limits and code search, add a Worker secret:

```bash
npx wrangler secret put GITHUB_TOKEN
```

Never commit the token.

### 6. Connect from ChatGPT

Add a custom MCP server in ChatGPT using:

```text
https://<your-worker-hostname>/mcp
```

Choose OAuth authentication. The Worker publishes the OAuth protected-resource and authorization-server metadata required for discovery.

## Search profiles

`search` supports:

- `web`
- `news`
- `supplier`
- `commerce`
- `technical`

Market hints:

- `global`
- `SA` — Saudi Arabia
- `AE` — United Arab Emirates
- `CN` — China

These are query-expansion hints, not guaranteed geolocated SERPs.

## Optional Bing web RSS

Bing web RSS is disabled by default:

```json
"ENABLE_BING_RSS": "0"
```

If you enable it, review Microsoft's current terms for that endpoint and make sure your intended use is permitted. The default free path does not require Bing RSS.

## Optional paid Cloudflare Web Search

The repository defaults to:

```json
"ALLOW_PAID_WEBSEARCH": "0"
```

This prevents accidental use of paid Cloudflare Web Search providers. If you intentionally enable it, review current Cloudflare pricing and provider configuration first.

## Limitations

Public search endpoints can throttle or change markup. Marketplace sites and bot-protected pages may still require specialized data providers or proxies. This project is best used as a low-cost search/retrieval layer, not as a guarantee of Google-equivalent local SERPs.

## License

MIT


## Reliable open-source search: SearXNG

The Worker now integrates the independently maintained [SearXNG](https://github.com/searxng/searxng) metasearch server via its documented JSON search API. SearXNG runs **separately** (Python/Docker); the Worker stays on Cloudflare.

The integration is optional. To use it, deploy an HTTPS SearXNG instance and set the Worker environment variable `SEARXNG_URL` to its public HTTPS base address. JSON must be enabled in SearXNG's `settings.yml`:

```yaml
use_default_settings: true
search:
  formats: [html, json]
```

Set a secure SearXNG `server.secret_key` and protect the deployment behind access control or an authenticated reverse proxy. If your reverse proxy accepts Bearer credentials, store one as a **Cloudflare Worker secret**, never in the repository:

```bash
npx wrangler secret put SEARXNG_BEARER_TOKEN
```

The Worker calls `GET /search?q=...&format=json`, passes market-sensitive language settings and normalizes the results into the existing MCP result format. `backend: "searxng"` forces SearXNG; `backend: "free"` or `"auto"` prefer it when configured and fall back to the existing retrieval sources if the instance is unavailable.

The service is free open-source software, but **hosting and upstream rate-limits are not free of operational constraints**. SearXNG is **AGPL-3.0** and runs as its own upstream service; this repository contains only a HTTP client adapter and does not copy its server source. For deployment, follow the **current** [SearXNG container installation documentation](https://docs.searxng.org/admin/installation-docker), not the archived searxng-docker repository. Respect the terms and robots policies of upstream search engines.

RSS and publisher metadata are parsed using the MIT-licensed [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) and [Cheerio](https://github.com/cheeriojs/cheerio), replacing regex-based XML parsing.


## Personal-use public SearXNG fallback chain

**This remote MCP is designed for one person's private use.** Public SearXNG instances are operated by independent volunteers, and an HTML search page does **not** imply authorization for automated JSON API requests. Do not put private supplier communications, credentials, addresses or other sensitive query details through an operator you do not trust.

The optional SearXNG provider supports an **explicitly configured, sequential failover chain**. It never discovers random public hosts or adds unapproved instances at runtime.

Configuration (set Worker variables/secrets through your Cloudflare environment, never in Git):

\`\`\`text
SEARXNG_URL=https://approved-primary.example.org
SEARXNG_URLS=https://approved-backup-1.example.org,https://approved-backup-2.example.org
SEARXNG_MAX_ATTEMPTS=2
SEARXNG_TIMEOUT_MS=5500
\`\`\`

\`SEARXNG_URL\` is the first instance. \`SEARXNG_URLS\` appends additional instances; duplicates are discarded. The chain attempts a maximum of **two** instances per search by default, with a hard maximum of three. Each attempt has its own bounded timeout and response-size limit. Requests are serial, and the \`multi_search\` MCP tool runs queries serially whenever a SearXNG backend is configured to reduce load on public instances.

The chain accepts **only HTTPS public hostnames**. If the primary requires a bearer token, save it as the Worker secret \`SEARXNG_BEARER_TOKEN\`; it is sent **only to the primary's origin**, never to backups. All target instances must independently allow your planned personal JSON API use. In particular, [priv.au's personal-use API](https://priv.au/api) requires **an operator-issued API key**; visiting the site without a key is not enough.

Fallback behavior:

1. A successful JSON response containing results that meet the MCP relevance and domain-filter checks is returned immediately.
2. Timeout, 5xx, invalid JSON, or empty/low-quality results temporarily cool down that instance and allow the **next explicitly approved** instance, within the attempt limit.
3. HTTP **401, 403 or 429** stops the public-instance chain immediately; it never switches to another public host to work around an API denial or quota.
4. If all approved hosts are unavailable, the MCP's existing DuckDuckGo/Bing retrieval paths remain available for best-effort fallback.
5. Results include \`searxng_chain\` diagnostics showing attempted/skipped/selected **host origins only** (not bearer credentials or request URLs).

The host cooldown is best-effort within a Cloudflare isolate; it is **not** a globally consistent distributed rate limiter. Do not configure public hosts for production unless their policies authorize automated API queries and the JSON response has been verified from the Worker runtime.

SearXNG directory: [searx.space](https://searx.space/). The directory measures **web search**, not authorization or JSON availability. Do not equate a 100% directory availability score with a usable search API.

**Important:** In the October 8, 2026 one-request-per-host GitHub Actions checks, all initially selected public instances returned HTML, HTTP 403, or HTTP 429 instead of JSON. The repository intentionally ships with **no public hostnames enabled by default**. This keeps hosting free and avoids changing production behavior before operator permission is secured.

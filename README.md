# Cloudflare ChatGPT Search MCP

A remote, read-only Model Context Protocol (MCP) search server designed to run on **Cloudflare Workers** and connect to **ChatGPT web** over Streamable HTTP.

## Features

- OAuth 2.1 + PKCE using Cloudflare's Workers OAuth Provider
- ChatGPT CIMD allowlist: the authorization endpoint only accepts ChatGPT client metadata documents
- Free web search using DuckDuckGo HTML, with DuckDuckGo Lite and canonicalized Bing HTML as quality fallbacks; Bing web RSS is available as an explicit opt-in
- Canonical URL resolution for DuckDuckGo and Bing tracking redirects before filtering and attribution
- Strict post-retrieval domain filtering, including subdomains of requested domains
- Lightweight lexical relevance scoring/gating to suppress malformed or off-topic SERP results
- Adaptive `backend: "auto"` behavior with free fallback escalation, market-aware Arabic/Chinese sourcing queries, quality diagnostics, and optional paid Cloudflare Web Search escalation
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

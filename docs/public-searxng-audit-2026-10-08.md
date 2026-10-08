# Public SearXNG candidates — personal-use API audit

Checked: **2026-10-08**. Public inventory source: [searx.space](https://searx.space/) ([machine-readable snapshot](https://searx.space/data/instances.json)). Instances were selected for recent search-check success and engine diversity, **not** for API authorization.

Probe method: **one** low-volume `GET /search?q=SearXNG+API+capability+check&format=json` per candidate via GitHub Actions, no retries, no concurrent fan-out, no CAPTCHA bypass. Probe script was removed from the repository after use. The status below reflects only the probe's GitHub Actions egress identity and that specific timestamp. Web availability from the directory does **not** prove JSON API access.

| Candidate | Directory search check | Working engines | API probe | Decision |
|---|---:|---:|---|---|
| [searx.ononoki.org](https://searx.ononoki.org/) | 100% | 4 | HTTP 429 | Exclude; rate-limited |
| [search.pereira.is](https://search.pereira.is/) | 100% | 3 | HTTP 429 | Exclude |
| [search.inetol.net](https://search.inetol.net/) | 100% | 2 | HTTP 200 HTML, not JSON | Exclude from JSON chain |
| [searx.tiekoetter.com](https://searx.tiekoetter.com/) | 100% | 1 | HTTP 429 | Exclude |
| [baresearch.org](https://baresearch.org/) | 100% | 2 | HTTP 200 HTML, not JSON | Exclude |
| [www.isci.si](https://www.isci.si/) | 100% | 4 | HTTP 403 | Exclude |
| [searxng.site](https://searxng.site/) | 100% | 2 | HTTP 403 | Exclude |
| [search.femboy.ad](https://search.femboy.ad/) | 100% | 5 | HTTP 429 | Exclude |
| [search.pi.vps.pw](https://search.pi.vps.pw/) | 100% | 2 | HTTP 403 | Exclude |
| [search.lumy.live](https://search.lumy.live/) | 100% | 2 | Timeout at 6.5 s | Exclude |
| [searxng.eshnetwork.space](https://searxng.eshnetwork.space/) | 100% | 1 | HTTP 429 | Exclude |
| [search.jeremyh.xyz](https://search.jeremyh.xyz/) | 80% | 5 | HTTP 429 | Exclude |
| [searxng.website](https://searxng.website/) | 100% | 1 | HTTP 403 | Exclude |
| [search.spiralab.org](https://search.spiralab.org/) | 60% | 2 | HTTP 429 | Exclude |

**No unauthenticated public JSON API endpoint has been positively validated.** Do not hard-code any candidate above into the default MCP Worker configuration.

## Operator-approved personal-use option: PrivAU

[PrivAU's official API page](https://priv.au/api) states that the operator manually issues keys **for academic/personal use only**, requires applicants to describe their intended searches and approximate per-day volume, and supports `Authorization: Bearer KEY`, HTTP Basic, or `X-API-Key: KEY`. The MCP adapter supports the Bearer variant and stores the key as a Cloudflare secret.

- Obtain the key directly from the operator, describing the actual use case, including any product/supplier research.
- Configure PrivAU as `SEARXNG_URL=https://priv.au` **only after approval**.
- Store its key as `SEARXNG_BEARER_TOKEN` through Cloudflare secrets; do not paste it into GitHub.
- A backup instance must separately approve the intended JSON use.
- **Personal-only use of this MCP does not itself override an individual operator's conditions.**

## Operational security

The SearXNG fallback code is present but inert until at least one approved `SEARXNG_URL` or `SEARXNG_URLS` is set. It tries approved hosts sequentially, limits attempts and response sizes, respects 401/403/429, and keeps the primary bearer key out of backups. It is **not** a way to circumvent public-instance limits. It also does not anonymize searches from the SearXNG operator.

Directory measurements can be updated independently; do not carry over these health rankings indefinitely.

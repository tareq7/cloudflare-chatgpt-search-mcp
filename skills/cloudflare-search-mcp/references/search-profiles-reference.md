# Search Profiles & Fallback Architecture Reference

This reference describes the search modes, regional markets, and 100% free multi-tier retrieval engine underlying **Tareq Search MCP**.

---

## 1. Search Modes

The `mode` argument in `search` and `multi_search` tunes query transformation, relevance scoring, and provider routing:

| Mode | Target Scope | Query Expansion & Scoring Heuristics | Recommended Use Cases |
|---|---|---|---|
| `web` | General Web | Canonicalizes redirect targets, applies lexical gating to discard spam SERPs. | General facts, articles, blog posts, news commentary. |
| `news` | News Articles | Consumes Google News RSS and Bing News RSS with independent parser failover and publisher domain verification. | Breaking events, press releases, company announcements. |
| `supplier` | Sourcing & Manufacturing | Injects manufacturing indicators (`factory`, `OEM`, `wholesale`, `distributor`, `supplier`, `catalog`). | Electronic components, industrial parts, CNC milling, fabrication vendors. |
| `commerce` | Retail & Pricing | Injects commerce terms (`buy`, `price`, `specs`, `review`, `in stock`). | Product specifications, hardware MSRP, retail availability. |
| `technical` | Code & Documentation | Favors GitHub, package registries (npm, PyPI, crates.io), RFCs, and official documentation portals. | API references, library bugs, error codes, implementation guides. |

---

## 2. Regional Market Targeting

The `market` parameter provides regional sourcing expansions without requiring expensive geotargeted proxy pools:

- **`global`**: Standard worldwide search.
- **`SA` (Saudi Arabia)**: Expands queries with Saudi commercial terms and Arabic/English bilingual keywords (e.g. `السعودية`, `موزع معتمد`, `الرياض`).
- **`AE` (United Arab Emirates)**: Expands queries with UAE and Dubai commercial hub terms (`UAE`, `Dubai distributor`, `free zone supplier`).
- **`CN` (China)**: Expands queries for direct Asian manufacturing sourcing (`Shenzhen`, `Guangdong`, `Dongguan`, `OEM factory`, `direct manufacturer`).

---

## 3. The 100% Free Retrieval Engine

Unlike traditional search MCPs that require paid API subscriptions (Brave, Exa, Google Custom Search, Serper), Tareq Search MCP utilizes a 100% free, high-resilience retrieval cascade:

```
                  ┌──────────────────────────────┐
                  │      Incoming Query          │
                  └──────────────┬───────────────┘
                                 │
                 Is SEARXNG_URL configured?
                    ┌────────────┴────────────┐
                   YES                        NO
                    │                          │
        ┌───────────▼───────────┐              │
        │ Primary SearXNG JSON  │              │
        └───────────┬───────────┘              │
             Fail / │                          │
           Cool down│                          │
        ┌───────────▼───────────┐              │
        │ Backup SearXNG (opt)  │              │
        └───────────┬───────────┘              │
             Fail / │                          │
           Unavail  │                          │
                    └────────────┬─────────────┘
                                 │
                   ┌─────────────▼─────────────┐
                   │    DuckDuckGo HTML        │
                   └─────────────┬─────────────┘
                                 │ 429 / Empty
                   ┌─────────────▼─────────────┐
                   │    DuckDuckGo Lite        │
                   └─────────────┬─────────────┘
                                 │ 429 / Empty
                   ┌─────────────▼─────────────┐
                   │    Bing Organic HTML      │
                   └─────────────┬─────────────┘
                                 │
                   ┌─────────────▼─────────────┐
                   │ Strict Domain Filter &    │
                   │ Lexical Relevance Gating  │
                   └─────────────┬─────────────┘
                                 │
                   ┌─────────────▼─────────────┐
                   │ Normalized MCP Results    │
                   └───────────────────────────┘
```

### Key Technical Guarantees
1. **Canonical URL Resolution**: Both DuckDuckGo and Bing return wrapped tracking redirects (`duckduckgo.com/l/?uddg=...` and `bing.com/ck/a?...`). The engine unpacks these into canonical destination URLs before filtering, preventing attribution errors.
2. **Strict Domain Filtering**: Domain filters are applied after canonical unwrapping and match exact subdomains.
3. **Lexical Relevance Gating**: Suppresses noisy SERP results that do not match the query keywords.
4. **Host Isolation**: If a private SearXNG instance uses custom authorization, credentials are scoped strictly to the primary host and never forwarded to backup instances.

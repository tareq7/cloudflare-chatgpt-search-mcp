# Agensi.io Marketplace Listing Dossier: Cloudflare Search MCP

This dossier contains the complete listing collateral, product positioning, listing card layout, and metadata for publishing **Cloudflare Search MCP** on [Agensi.io](https://agensi.io).

---

## 1. Listing Metadata

| Field | Value |
|---|---|
| **Skill Name** | `cloudflare-search-mcp` |
| **Listing Title** | Cloudflare Web Search MCP — 100% Free Autonomous Agent Research |
| **Short Tagline / Hook** | Deep web research, supplier sourcing, and doc extraction with zero API billing. Compatible with Claude Code, Cursor, Copilot & 20+ agents. |
| **Category** | Developer Tools / Research & Web |
| **Price** | Free ($0) / Recommended Free Community Tier |
| **License** | MIT |
| **Author / Creator** | Tareq Naji |
| **Compatible Agents** | Claude Code, Cursor, VS Code (GitHub Copilot), Codex CLI, Windsurf, Roo Code, ChatGPT Web |
| **Keywords / Tags** | `mcp`, `web-search`, `deep-research`, `duckduckgo`, `searxng`, `github-search`, `free-search`, `cloudflare` |
| **Submission Archive** | `dist/cloudflare-search-mcp-skill.zip` |

---

## 2. Agensi Listing Card Specification (1920 × 1080)

Agensi.io creators utilize a 1920×1080 presentation card on their listing page. Here is the layout specification:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE SEARCH MCP                                               [ AGENSI VERIFIED ]│
│  Autonomous Deep Web Research for 20+ AI Coding Agents               [ 100% FREE STACK ]│
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   🔍 ZERO-COST RESEARCH          ⚡ MULTI-TIER RESILIENCE       🛡️ SECURE & ISOLATED    │
│   100% free search stack.        SearXNG JSON/HTML metasearch   Read-only design with  │
│   Zero paid API credits          + DuckDuckGo HTML/Lite         SSRF protection and    │
│   consumed (no Exa or Brave).    + Bing HTML organic fallback.  prompt injection guard.│
│                                                                                        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  SUPPORTED RUNTIMES:                                                                   │
│  [Claude Code]   [Cursor]   [GitHub Copilot]   [Codex]   [Windsurf]   [ChatGPT Web]    │
│                                                                                        │
│  HOW IT WORKS:                                                                         │
│  1. Unzip to ~/.claude/skills/ or .cursor/mcp.json                                     │
│  2. Agent automatically decides when to trigger search, multi_search, or fetch_page   │
│  3. Enjoy unlimited, private web research directly inside your agent terminal          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Marketplace Listing Body (Sales Copy)

### Headline
**Stop paying per-query search API bills. Equip your AI coding agents with unlimited, resilient, multi-angle web research.**

### The Problem
Most search tools for AI coding agents force you into costly subscription tiers or pay-per-token API plans (Exa, Brave Search, Serper). When an agent enters an autonomous debugging loop, it can burn through dollars of search credits in minutes. Furthermore, raw search MCPs lack the instructional logic (`SKILL.md`) that guides agents on *when* and *how* to decompose complex queries, verify primary sources, and avoid prompt injections.

### The Solution: Cloudflare Search MCP Skill
**Cloudflare Search MCP** pairs a battle-tested Model Context Protocol server with an intelligent, specification-compliant **Agent Skill**. 

It runs on a **100% free search engine stack**:
1. **SearXNG Metasearch**: Privacy-first metasearch aggregation (JSON & HTML).
2. **DuckDuckGo HTML & Lite**: High-speed, unmetered web discovery with canonical redirect resolution.
3. **Bing Organic HTML**: Deep fallback with automated tracking canonicalization.
4. **Google & Bing News RSS**: Independent parsing with publisher domain filtering.
5. **GitHub API Integration**: Direct repository, issue, and code search without web noise.
6. **Safe Page Extraction (`fetch_page`)**: Clean text extraction with strict SSRF defense.

### Key Capabilities
- **`search`**: General web, news, supplier, commerce, and technical search profiles. Supports geographic context expansions for Saudi Arabia (`SA`), United Arab Emirates (`AE`), and China (`CN`).
- **`multi_search`**: Spawns up to 6 distinct research angles concurrently with automatic URL deduplication and domain diversity.
- **`fetch_page`**: Reads primary documentation sources directly, with optional headless JavaScript rendering via Cloudflare Browser Run.
- **`github_search`**: Pinpoints relevant repositories, PR discussions, and code examples.

### One-Minute Installation

#### In Claude Code:
```bash
claude mcp add tareq-search -- node ./scripts/stdio-server.mjs
```

#### In Cursor (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "tareq-search": {
      "command": "node",
      "args": ["${workspaceFolder}/scripts/stdio-server.mjs"]
    }
  }
}
```

#### In ChatGPT Web:
Connect directly via Streamable HTTP and OAuth 2.1 to your hosted Cloudflare Worker.

---

## 4. Agensi 8-Point Security Verification

Every release is audited against Agensi's automated security standard:
- ✅ **1. Valid Structure**: Strict `SKILL.md` YAML frontmatter and folder hierarchy.
- ✅ **2. Safe Types**: Pure Markdown, JSON, and clean ESM Node.js. No binary executables.
- ✅ **3. No Destructive Commands**: Zero dangerous bash or disk wipe commands.
- ✅ **4. Zero Hardcoded Secrets**: Worker secrets and tokens are isolated; templates contain placeholders only.
- ✅ **5. No Env Harvesting**: Reads only explicit search configurations.
- ✅ **6. Audited Network Access**: Outbound requests strictly connect to documented public search endpoints.
- ✅ **7. Prompt Injection Defense**: Instructs agents to isolate untrusted web text.
- ✅ **8. No Unauthorized Calls**: No background analytics, telemetry, or third-party pings.

---

## 5. Pricing & Go-To-Market Strategy

- **Recommendation**: Launch as a **Free Community Skill** on Agensi.io.
- **Rationale**: 
  - Agensi has **65,000+ monthly visitors** searching for web research tools.
  - Turning the 1-star ChatGPT-only rating into a top-rated, universal AI agent skill establishes creator credibility.
  - Generates inbound interest for custom enterprise search MCP deployments and high-ticket consulting while keeping hosting costs at $0.

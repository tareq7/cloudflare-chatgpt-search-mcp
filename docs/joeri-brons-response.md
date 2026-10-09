# Response to Joeri Brons (Agensi.io)

**Subject:** Re: Cloudflare hosted search MCP / Agensi.io Skill Listing

---

Hi Joeri,

Thanks for reaching out and for following the project.

You made an accurate observation: the original release was tightly coupled to ChatGPT Web's OAuth CIMD specification, which created friction for power users and agent developers using Claude Code, Cursor, or Copilot.

I have completely repackaged the server into a universal AI agent capability paired with an open-standard `SKILL.md` specification:

1. **Universal 20+ Agent Compatibility**: Packaged with a standard `SKILL.md` skill definition and ready-to-use configurations for Claude Code (`claude mcp add`), Cursor (`.cursor/mcp.json`), VS Code / Copilot, Windsurf, Codex, and ChatGPT Web.
2. **Dual-Mode Execution**: It can run either hosted on Cloudflare Workers over Streamable HTTP / SSE, or completely locally as a zero-config stdio MCP server (`node scripts/stdio-server.mjs`) without requiring a Cloudflare account.
3. **100% Free Search Stack**: We completely eliminated all paid third-party search APIs (Exa, Brave, Ceramic). The backend now runs a multi-tier free retrieval engine (SearXNG JSON/HTML metasearch, DuckDuckGo HTML & Lite, canonicalized Bing organic HTML, Google/Bing News RSS, and GitHub API). It costs $0 in search API credits.
4. **Agent Research Playbook**: The skill instructs agents on when to select specialized search modes (`technical`, `supplier`, `commerce`, `news`), how to run multi-angle queries (`multi_search`), when to fetch and verify primary documentation (`fetch_page`), and how to defend against indirect prompt injections on scraped web pages.
5. **Agensi 8-Point Security Audit**: The skill package has been audited against your 8-point automated security scan (safe file types, zero hardcoded secrets, no destructive commands, SSRF-protected page fetching).

I would love to list this on Agensi.io. I've prepared the validated submission ZIP (`dist/cloudflare-search-mcp-skill.zip`) and full listing collateral.

Could you share the direct onboarding link for the Creator Dashboard, and let me know if there are any specific guidelines for featured placement on the marketplace?

Best regards,

Tareq Naji  
https://github.com/tareq7/cloudflare-chatgpt-search-mcp

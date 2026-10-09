# Agensi 8-Point Automated Security Scan Compliance

Agensi.io enforces a mandatory 8-point automated security scan on every skill submitted to its marketplace. This document certifies how **Tareq Search MCP** (`cloudflare-search-mcp`) passes all 8 checks.

---

## Audit Checklist & Verification

### 1. File Structure Validation
- **Requirement**: Must contain a valid `SKILL.md` with properly formed YAML frontmatter; directory structure must be clean; no oversized files or hidden binaries.
- **Compliance**:
  - `SKILL.md` is at the skill root with RFC-compliant YAML frontmatter containing `name`, `version`, `description`, `author`, `license`, `compatibility`, and `allowed-tools`.
  - Directory structure adheres to the open standard: `/references`, `/examples`, `/scripts`.
  - Zero bloated files or suspicious archive structures.

### 2. File Type Screening
- **Requirement**: Plain text instructions and safe code only. No binary files (`.exe`, `.dll`, `.so`, `.bin`, `.wasm`) or obfuscated scripts.
- **Compliance**:
  - All files are UTF-8 Markdown (`.md`), JSON (`.json`), or plain ESM JavaScript (`.mjs`, `.js`).
  - No compiled binaries or opaque blobs.

### 3. Dangerous Command Patterns
- **Requirement**: Zero destructive shell execution patterns, disk-level commands, privilege escalation, or pipe-to-shell patterns (`curl ... | sh`).
- **Compliance**:
  - Contains no shell injection vectors or destructive commands (`rm -rf`, `fdisk`, `chmod 777`, `sudo`).
  - All commands in documentation are standard agent registration calls (`claude mcp add ...`, `npm install`).

### 4. Secrets Detection
- **Requirement**: No hardcoded API keys, bearer tokens, private keys, or passwords.
- **Compliance**:
  - Zero hardcoded API keys or bearer tokens exist in the repository or skill files.
  - Public repository uses template placeholders (`00000000000000000000000000000000`, `https://your-worker...`).
  - Private credentials are bound exclusively via Cloudflare Worker secrets and never tracked in Git.

### 5. Environment Variable Harvesting
- **Requirement**: No scraping of arbitrary host environment variables or exfiltration of system envs.
- **Compliance**:
  - The codebase only reads specific, documented config variables (`SEARXNG_URL`, `GITHUB_TOKEN`, `AGENT_TOKEN`).
  - It never iterates or exposes `process.env` keys.

### 6. Network Access Audit
- **Requirement**: Outbound network requests must be transparent, documented, and justified.
- **Compliance**:
  - All outbound endpoints are explicitly declared:
    - DuckDuckGo (`html.duckduckgo.com`, `lite.duckduckgo.com`)
    - Bing (`bing.com`)
    - Google News RSS (`news.google.com`)
    - GitHub API (`api.github.com`)
    - User-configured SearXNG HTTPS instance (optional)
  - All endpoints are public search/RSS feeds. Zero private data exfiltration.

### 7. Prompt Injection Hardening
- **Requirement**: Must demonstrate awareness of indirect prompt injection from untrusted external sources.
- **Compliance**:
  - `SKILL.md` explicitly documents an untrusted content isolation protocol for text returned by `fetch_page`.
  - Instructs agents to treat fetched page content strictly as untrusted data rather than instructions.

### 8. Unexpected Network Calls
- **Requirement**: No background tracking, silent telemetry, analytics pixels, or unauthorized beaconing.
- **Compliance**:
  - Network calls occur strictly in direct response to user-initiated tool invocations (`search`, `multi_search`, `fetch_page`, `github_search`).
  - No background analytics or telemetry tracking.

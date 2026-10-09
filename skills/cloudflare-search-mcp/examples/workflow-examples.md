# End-to-End Autonomous Research Workflows

This document illustrates how AI agents (Claude Code, Cursor, Codex, Windsurf) utilize the Tareq Search MCP tools in practice.

---

## Scenario 1: Debugging an Upstream Framework Issue

### User Query
> "I'm seeing `Error: Cannot find module 'node:sea'` when running on Node 18. Did this API change or requires a specific flag?"

### Agent Reasoning & Actions
1. **Tool Invocation**: Agent runs `search` in `technical` mode:
   ```json
   {
     "query": "Node.js Single Executable Applications node:sea supported versions",
     "mode": "technical",
     "limit": 5
   }
   ```
2. **Analysis**: Results show that `node:sea` was introduced in Node.js v19.7.0 and stabilized in v20+. Node 18 lacks native `node:sea` support without experimental backports.
3. **Verification**: Agent calls `fetch_page` to confirm with official Node.js documentation:
   ```json
   {
     "url": "https://nodejs.org/api/single-executable-applications.html",
     "render_js": false
   }
   ```
4. **Agent Response**: Delivers concise explanation stating Node 18 compatibility boundaries with direct canonical documentation citations.

---

## Scenario 2: Sourcing Electronic Components (China & UAE Market)

### User Query
> "Find authorized distributors and stock for the STM32H753ZI microcontroller with rapid delivery to Dubai."

### Agent Reasoning & Actions
1. **Tool Invocation**: Uses `multi_search` with market hints for UAE and China sourcing:
   ```json
   {
     "queries": [
       "STM32H753ZI microcontroller stock distributor UAE Dubai",
       "STM32H753ZIT6 authorized distributor Gulf Middle East",
       "STM32H753ZI manufacturer Shenzhen export supplier"
     ],
     "mode": "supplier",
     "market": "AE",
     "limit_per_query": 5
   }
   ```
2. **Synthesis**: Deduplicates distributor URLs, identifies regional stocking distributors (Mouser Middle East, Element14, regional authorized hubs), and returns part pricing, lead times, and distributor contact links.

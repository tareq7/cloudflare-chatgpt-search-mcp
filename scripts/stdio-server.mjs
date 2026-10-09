#!/usr/bin/env node
/**
 * Tareq Search MCP - Local Stdio Server Runner
 *
 * Runs the Tareq Search MCP server over standard input/output (stdio)
 * for native local integration with Claude Code, Cursor, Codex, Windsurf,
 * Roo Code, VS Code Copilot, and other MCP-compliant agents.
 *
 * Uses the 100% free search stack (SearXNG, DuckDuckGo HTML/Lite, Bing HTML,
 * GitHub public search, fetch_page). No Cloudflare account or paid API keys required.
 */
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "../src/server.js";

process.on("unhandledRejection", (reason) => {
  console.error("[Tareq Search MCP Stdio] Unhandled Rejection:", reason);
});

async function main() {
  await serveStdio(() => createServer(process.env));
}

main().catch((err) => {
  console.error("Fatal error in Tareq Search MCP Stdio server:", err);
  process.exit(1);
});

# Multi-Agent MCP Setup Guide

This guide walks through configuring **Tareq Search MCP** across all major AI agent runtimes: Claude Code, Cursor, VS Code (GitHub Copilot), Codex CLI, Windsurf, Roo Code, and ChatGPT Web.

---

## Architecture Overview

Tareq Search MCP supports two deployment topologies:

1. **Local Stdio Process (Zero Cloud Deployment)**:
   Runs locally via `node scripts/stdio-server.mjs`. Perfect for desktop agents (Claude Code, Cursor, Windsurf) where zero setup and zero latency are desired. No Cloudflare account needed.

2. **Remote Cloudflare Worker (Streamable HTTP / SSE)**:
   Runs globally on Cloudflare edge. Accessible via `https://<worker-subdomain>.workers.dev/mcp`. Supports OAuth 2.1 + PKCE for ChatGPT web and optional Bearer token auth for autonomous agents.

---

## 1. Claude Code Setup

### Method 1: Local Stdio (Recommended)
Run the built-in CLI command:
```bash
claude mcp add tareq-search -- node ./scripts/stdio-server.mjs
```

Or configure manually in `.claude/mcp.json`:
```json
{
  "mcpServers": {
    "tareq-search": {
      "command": "node",
      "args": ["scripts/stdio-server.mjs"]
    }
  }
}
```

### Method 2: Remote Worker
In `~/.claude/mcp.json` or `.claude/mcp.json`:
```json
{
  "mcpServers": {
    "tareq-search": {
      "url": "https://<your-worker>.workers.dev/mcp"
    }
  }
}
```

---

## 2. Cursor Setup

Add the server to `.cursor/mcp.json`:

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

For remote Worker:
```json
{
  "mcpServers": {
    "tareq-search": {
      "url": "https://<your-worker>.workers.dev/mcp"
    }
  }
}
```

Restart Cursor or reload the MCP servers panel in **Cursor Settings** -> **Features** -> **MCP**.

---

## 3. Visual Studio Code & GitHub Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "tareq-search": {
      "command": "node",
      "args": ["${workspaceFolder}/scripts/stdio-server.mjs"]
    }
  }
}
```

---

## 4. Windsurf & Roo Code

In `mcp_config.json`:

```json
{
  "mcpServers": {
    "tareq-search": {
      "command": "node",
      "args": ["scripts/stdio-server.mjs"]
    }
  }
}
```

---

## 5. ChatGPT Web

1. Deploy the Cloudflare Worker:
   ```bash
   npm install
   npm run deploy
   ```
2. In ChatGPT Web, open **Settings** -> **Connected Apps** -> **Add Custom MCP**.
3. Set URL to `https://<your-worker>.workers.dev/mcp`.
4. Choose **OAuth** authentication.
5. ChatGPT will discover OAuth endpoints at `/.well-known/oauth-protected-resource/mcp`, redirect through `/authorize`, and register the MCP connection.

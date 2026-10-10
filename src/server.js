import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  searchWeb,
  multiSearch,
  fetchPage,
  githubSearch,
} from "./search.js";

export function jsonResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function errorResult(error) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({ error: String(error?.message || error) }, null, 2),
    }],
  };
}

export function createServer(env = (typeof process !== "undefined" ? process.env : {})) {
  const server = new McpServer({
    name: "Tareq Search MCP",
    version: "1.0.0",
  });

  server.registerTool(
    "search",
    {
      title: "Search the web",
      description:
        "Search current web or news sources. Uses a configured SearXNG metasearch instance when available, otherwise free search providers. Use mode=supplier for manufacturers, warehouses, or distributors; commerce for products, pricing, or marketplaces; technical for docs, GitHub, releases, or APIs; and news for fresh reporting. SA, AE, and CN market settings add geographic context. Default search is free and does not consume paid search API credits.",
      inputSchema: {
        query: z.string().min(1).max(800),
        mode: z.enum(["web", "news", "supplier", "commerce", "technical"]).optional().default("web"),
        market: z.enum(["global", "SA", "AE", "CN"]).optional().default("global"),
        limit: z.number().int().min(1).max(20).optional().default(10),
        domains: z.array(z.string().min(1).max(253)).max(5).optional().default([]),
        backend: z.enum(["free", "auto", "searxng", "brave"]).optional().default("auto"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        return jsonResult(await searchWeb(env, args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "multi_search",
    {
      title: "Search multiple angles",
      description:
        "Run up to six related searches concurrently, merge duplicates, and diversify domains. Use this for supplier discovery, competitive research, product sourcing, or any question that needs several query angles rather than one lookup.",
      inputSchema: {
        queries: z.array(z.string().min(1).max(500)).min(1).max(6),
        mode: z.enum(["web", "news", "supplier", "commerce", "technical"]).optional().default("web"),
        market: z.enum(["global", "SA", "AE", "CN"]).optional().default("global"),
        limit_per_query: z.number().int().min(1).max(10).optional().default(6),
        domains: z.array(z.string().min(1).max(253)).max(5).optional().default([]),
        backend: z.enum(["free", "auto", "searxng", "brave"]).optional().default("auto"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        return jsonResult(await multiSearch(env, args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "fetch_page",
    {
      title: "Read a web page",
      description:
        "Fetch and extract a known public URL. Keep render_js=false for fast direct retrieval. Set render_js=true only for JavaScript-heavy pages that need a real browser; this uses Cloudflare Browser Run and should be reserved for pages that need rendering.",
      inputSchema: {
        url: z.string().url(),
        render_js: z.boolean().optional().default(false),
        max_chars: z.number().int().min(1000).max(50000).optional().default(30000),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        return jsonResult(await fetchPage(env, args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "github_search",
    {
      title: "Search GitHub",
      description:
        "Search GitHub repositories, issues or PRs, or code. Prefer this over general web search for repositories, dependencies, MCP implementations, issue discussions, and technical source discovery. Repository and issue search work without a stored GitHub credential; code search may require an optional GitHub token.",
      inputSchema: {
        query: z.string().min(1).max(500),
        kind: z.enum(["repositories", "issues", "code"]).optional().default("repositories"),
        limit: z.number().int().min(1).max(20).optional().default(10),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        return jsonResult(await githubSearch(env, args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

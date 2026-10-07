import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import OAuthProvider, {
  AuthorizationError,
  CimdFetchError,
} from "@cloudflare/workers-oauth-provider";
import {
  searchWeb,
  multiSearch,
  fetchPage,
  githubSearch,
} from "./search.js";

const ORIGIN = "https://your-worker.your-subdomain.workers.dev";
const RESOURCE = ORIGIN + "/mcp";
const READ_SCOPE = "search:read";

function jsonResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({ error: String(error?.message || error) }, null, 2),
    }],
  };
}

function createServer(env) {
  const server = new McpServer({
    name: "Cloudflare Search MCP",
    version: "1.0.0",
  });

  server.registerTool(
    "search",
    {
      title: "Search the web",
      description:
        "Search current web or news sources. Use mode=supplier for manufacturers, warehouses, or distributors; commerce for products, pricing, or marketplaces; technical for docs, GitHub, releases, or APIs; and news for fresh reporting. SA, AE, and CN market settings add geographic context. Default search is free and does not consume paid search API credits.",
      inputSchema: {
        query: z.string().min(1).max(800),
        mode: z.enum(["web", "news", "supplier", "commerce", "technical"]).optional().default("web"),
        market: z.enum(["global", "SA", "AE", "CN"]).optional().default("global"),
        limit: z.number().int().min(1).max(20).optional().default(10),
        domains: z.array(z.string().min(1).max(253)).max(5).optional().default([]),
        backend: z.enum(["free", "auto"]).optional().default("free"),
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

const McpApiHandler = {
  async fetch(request, env, ctx) {
    const host = new URL(ORIGIN).hostname;
    const handler = createMcpHandler(() => createServer(env), {
      route: "/mcp",
      legacy: "stateless",
      responseMode: "auto",
      allowedHostnames: [host],
      allowedOriginHostnames: [host, "chatgpt.com"],
      corsOptions: {
        origin: "https://chatgpt.com",
        methods: "GET, POST, OPTIONS",
        headers: "Content-Type, Authorization, MCP-Protocol-Version",
      },
      onerror(error) {
        console.error("MCP error", error);
      },
    });
    return handler(request, env, ctx);
  },
};

function isChatGPTClient(clientId) {
  try {
    const u = new URL(clientId);
    if (
      u.protocol !== "https:" ||
      u.hostname !== "chatgpt.com" ||
      u.search ||
      u.hash
    ) return false;

    return u.pathname === "/oauth/client.json" ||
      /^\/oauth\/[A-Za-z0-9._~-]+\/client\.json$/.test(u.pathname);
  } catch {
    return false;
  }
}

async function authorizationHandler(request, env) {
  const oauth = env.OAUTH_PROVIDER;

  try {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const parsed = await oauth.parseAuthRequest(request);

    if (!isChatGPTClient(parsed.clientId)) {
      return new Response("This MCP only authorizes ChatGPT web clients.", {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const completed = await oauth.completeAuthorization({
      request: parsed,
      userId: "chatgpt-web",
      metadata: { clientId: parsed.clientId },
      scope: parsed.scope,
      props: { role: "chatgpt" },
    });

    return Response.redirect(completed.redirectTo, 302);
  } catch (error) {
    console.error("Authorization error", error);

    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }

    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError
        ? error.description
        : "The OAuth client metadata could not be verified.";

      return new Response(message, {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    }

    throw error;
  }
}

const DefaultHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/authorize") {
      return authorizationHandler(request, env);
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "Cloudflare Search MCP",
        version: "1.0.0",
        mcp: "/mcp",
        authentication: "OAuth 2.1 + PKCE + ChatGPT CIMD allowlist",
        paid_web_search_enabled: env.ALLOW_PAID_WEBSEARCH === "1",
        tools: ["search", "multi_search", "fetch_page", "github_search"],
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return new Response("Not found", { status: 404 });
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: McpApiHandler,
  defaultHandler: DefaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  scopesSupported: [READ_SCOPE, "offline_access"],
  resourceMetadata: {
    resource: RESOURCE,
    authorization_servers: [ORIGIN],
    bearer_methods_supported: ["header"],
    resource_name: "Cloudflare Search MCP",
  },
  requiredScopes: [READ_SCOPE],
  clientIdMetadataDocumentEnabled: true,
  accessTokenTTL: 3600,
  refreshTokenTTL: 2592000,
});

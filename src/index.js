import { createServer } from "./server.js";
import { createMcpHandler } from "agents/mcp/server";
import OAuthProvider, {
  AuthorizationError,
  CimdFetchError,
} from "@cloudflare/workers-oauth-provider";

const ORIGIN = "https://your-worker.your-subdomain.workers.dev";
const RESOURCE = ORIGIN + "/mcp";
const READ_SCOPE = "search:read";


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
  resolveExternalToken: async ({ token, env }) => {
    if (env.AGENT_TOKEN && token === env.AGENT_TOKEN) {
      return { audience: RESOURCE, scope: [READ_SCOPE], props: { role: "agent" } };
    }
    if (env.ALLOW_ANONYMOUS_AGENTS === "1") {
      return { audience: RESOURCE, scope: [READ_SCOPE], props: { role: "agent" } };
    }
    return null;
  },
});

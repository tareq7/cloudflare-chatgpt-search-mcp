import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createServer, jsonResult, errorResult } from "../src/server.js";

test("createServer instantiates McpServer with all required agent tools", () => {
  const server = createServer({});
  assert.ok(server, "server instance created");
  assert.equal(server.server._serverInfo.name, "Tareq Search MCP");
  assert.equal(server.server._serverInfo.version, "1.0.0");

  // Verify jsonResult helper
  const jsonOut = jsonResult({ status: "ok" });
  assert.equal(jsonOut.content[0].type, "text");
  assert.ok(jsonOut.content[0].text.includes('"status": "ok"'));

  // Verify errorResult helper
  const errOut = errorResult(new Error("Test failure"));
  assert.equal(errOut.isError, true);
  assert.ok(errOut.content[0].text.includes("Test failure"));
});

test("createServer registers search, multi_search, fetch_page, and github_search tools", () => {
  const server = createServer({});
  const toolNames = Object.keys(server._registeredTools).sort();
  assert.deepEqual(toolNames, [
    "fetch_page",
    "github_search",
    "multi_search",
    "search",
  ]);
});

test("fetch_page tool returns controlled error when render_js=true without browser binding", async () => {
  const server = createServer({});
  const fetchTool = server._registeredTools["fetch_page"];
  assert.ok(fetchTool, "fetch_page tool registered");

  const result = await fetchTool.handler({
    url: "https://example.com/test",
    render_js: true,
  });

  assert.equal(result.isError, true);
  assert.ok(result.content[0].text.includes("Browser Run binding is unavailable"));
});

test("SKILL.md frontmatter matches registered tools in createServer", () => {
  const server = createServer({});
  const registered = Object.keys(server._registeredTools);

  const skillPath = resolve("skills/cloudflare-search-mcp/SKILL.md");
  const content = readFileSync(skillPath, "utf-8");
  const match = content.match(/allowed-tools:\r?\n([\s\S]*?)(?:\r?\n\w|$)/);
  assert.ok(match, "allowed-tools found in SKILL.md");

  for (const name of registered) {
    assert.ok(
      match[1].includes(`- ${name}`),
      `SKILL.md allowed-tools must include '${name}'`,
    );
  }
});

test("skills directory documentation does not contain broken tool names", () => {
  const skillDir = resolve("skills/cloudflare-search-mcp");
  const invalidPatterns = [
    /\bfetchPage\s*\(/,
    /\bmultiSearch\s*\(/,
    /\bsearchWeb\s*\(/,
    /\bgithubSearch\s*\(/,
  ];

  function checkDir(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const text = readFileSync(fullPath, "utf-8");
        for (const pat of invalidPatterns) {
          assert.equal(
            pat.test(text),
            false,
            `File ${entry.name} contains invalid tool call matching ${pat}`,
          );
        }
      }
    }
  }

  checkDir(skillDir);
});

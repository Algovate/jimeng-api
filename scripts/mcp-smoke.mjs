#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REQUIRED_TOOLS = ["health_check", "list_models", "generate_image"];
const ADVANCED_TOOLS = ["edit_image", "generate_video"];
const STRICT = process.argv.includes("--strict");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const enableAdvancedTools =
    (process.env.MCP_ENABLE_ADVANCED_TOOLS || "true").toLowerCase() !== "false";

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/mcp/index.js"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      JIMENG_API_BASE_URL: process.env.JIMENG_API_BASE_URL || "http://127.0.0.1:5100"
    },
    stderr: "pipe"
  });

  if (transport.stderr) {
    transport.stderr.on("data", () => {
      // Ignore server stderr logs in smoke output.
    });
  }

  const client = new Client({
    name: "jimeng-mcp-smoke",
    version: "1.0.0"
  });

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    const toolNames = tools.map((tool) => tool.name);

    for (const name of REQUIRED_TOOLS) {
      assert(toolNames.includes(name), `Missing required MCP tool: ${name}`);
    }

    if (enableAdvancedTools) {
      for (const name of ADVANCED_TOOLS) {
        assert(toolNames.includes(name), `Missing advanced MCP tool: ${name}`);
      }
    }

    const healthResult = await client.callTool({
      name: "health_check",
      arguments: {}
    });

    assert(!healthResult.isError, "health_check returned an error");

    if (STRICT) {
      const guardedResult = await client.callTool({
        name: "generate_image",
        arguments: {
          prompt: "smoke guard test"
        }
      });
      assert(guardedResult.isError, "Expected confirm guard to block generate_image");
    }

    console.log("MCP smoke checks passed.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`MCP smoke checks failed: ${error.message}`);
  process.exit(1);
});

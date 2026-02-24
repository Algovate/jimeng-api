import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toToolResult, withToolError } from "./result.ts";

interface RegisterToolOptions {
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export function registerSafeTool<TArgs extends Record<string, unknown>>(
  server: McpServer,
  name: string,
  options: RegisterToolOptions,
  handler: (args: TArgs) => Promise<unknown>
): void {
  const { title, description, inputSchema, annotations } = options;

  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema,
      ...(annotations ? { annotations } : {})
    },
    async (args: TArgs) =>
      withToolError(async () => {
        const result = await handler(args);
        return toToolResult(result);
      })
  );
}

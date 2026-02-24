import { assertRunConfirm } from "../guards.ts";
import { generateVideoInputSchema } from "../schemas.ts";
import type { ToolDeps } from "../types.ts";
import { registerSafeTool } from "../tool-factory.ts";

export function registerGenerateVideoTool({ server, config, client }: ToolDeps): void {
  registerSafeTool(
    server,
    "generate_video",
    {
      title: "Generate Video",
      description: "Generate video with safe first_last_frames mode",
      inputSchema: generateVideoInputSchema
    },
    async (args) => {
      assertRunConfirm(config, args.confirm);

      return client.generateVideo(
        {
          prompt: args.prompt,
          model: args.model,
          ratio: args.ratio,
          resolution: args.resolution,
          duration: args.duration ?? 5,
          functionMode: "first_last_frames"
        },
        { token: args.token }
      );
    }
  );
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const CLI = ["node", "dist/cli/index.js"];

function run(args, { expectCode = 0, mustInclude = [] } = {}) {
  const [cmd, ...baseArgs] = CLI;
  const result = spawnSync(cmd, [...baseArgs, ...args], {
    encoding: "utf8",
  });

  const combined = `${result.stdout || ""}${result.stderr || ""}`;

  if (result.status !== expectCode) {
    throw new Error(
      `Command failed with unexpected exit code.\n` +
        `cmd: ${CLI.join(" ")} ${args.join(" ")}\n` +
        `expected: ${expectCode}\nactual: ${result.status}\n` +
        `output:\n${combined}`
    );
  }

  for (const text of mustInclude) {
    if (!combined.includes(text)) {
      throw new Error(
        `Command output missing expected text.\n` +
          `cmd: ${CLI.join(" ")} ${args.join(" ")}\n` +
          `missing: ${text}\n` +
          `output:\n${combined}`
      );
    }
  }
}

function main() {
  run(["--help"], { mustInclude: ["jimeng <command>"] });
  run(["models", "list", "--help"], { mustInclude: ["jimeng models list"] });
  run(["token", "--help"], { mustInclude: ["jimeng token <subcommand>"] });
  run(["token", "list", "--help"], { mustInclude: ["jimeng token list"] });
  run(["token", "check", "--help"], { mustInclude: ["jimeng token check"] });
  run(["token", "add", "--help"], { mustInclude: ["jimeng token add"] });
  run(["image", "generate", "--help"], { mustInclude: ["jimeng image generate"] });
  run(["video", "generate", "--help"], {
    mustInclude: ["--mode <mode>", "text_to_video", "image_to_video", "first_last_frames", "omni_reference"],
  });

  // Parameter guard smoke test: required args should fail fast.
  run(["image", "generate"], { expectCode: 1, mustInclude: ["Missing required --prompt"] });
  run(["video", "generate", "--mode", "image_to_video", "--prompt", "demo"], {
    expectCode: 1,
    mustInclude: ["image_to_video mode requires exactly one --image-file input"],
  });
  run(["video", "generate", "--mode", "first_last_frames", "--prompt", "demo"], {
    expectCode: 1,
    mustInclude: ["first_last_frames mode requires at least one --image-file input"],
  });
  run(["video", "generate", "--mode", "omni_reference", "--prompt", "demo"], {
    expectCode: 1,
    mustInclude: ["omni_reference mode requires at least one --image-file or --video-file input"],
  });
  run(["video", "generate", "--mode", "text_to_video", "--prompt", "demo", "--image-file", "https://example.com/a.png"], {
    expectCode: 1,
    mustInclude: ["text_to_video mode does not accept --image-file or --video-file inputs."],
  });
  run(["video", "generate", "--mode", "omni_reference", "--prompt", "demo", "--image-file", "https://example.com/a.png", "--model", "jimeng-video-3.0"], {
    expectCode: 1,
    mustInclude: ["omni_reference mode requires --model jimeng-video-seedance-2.0 or jimeng-video-seedance-2.0-fast"],
  });
  run(["video", "generate", "--mode", "image_to_video", "--prompt", "demo", "--image-file", "https://example.com/a.png", "--video-file", "https://example.com/b.mp4"], {
    expectCode: 1,
    mustInclude: ["image_to_video mode does not accept --video-file."],
  });
  run(["video", "generate", "--mode", "first_last_frames", "--prompt", "demo", "--image-file", "https://example.com/a.png", "--image-file", "https://example.com/b.png", "--image-file", "https://example.com/c.png"], {
    expectCode: 1,
    mustInclude: ["first_last_frames mode supports at most 2 image inputs."],
  });
  run(["video", "generate", "--prompt", "demo", "--mode", "bad-mode"], {
    expectCode: 1,
    mustInclude: ["Invalid --mode: bad-mode"],
  });

  console.log("CLI smoke checks passed.");
}

main();

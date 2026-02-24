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
  run(["token", "check", "--help"], { mustInclude: ["jimeng token check"] });
  run(["image", "generate", "--help"], { mustInclude: ["jimeng image generate"] });
  run(["video", "generate", "--help"], { mustInclude: ["jimeng video generate"] });

  // Parameter guard smoke test: required args should fail fast.
  run(["image", "generate"], { expectCode: 1, mustInclude: ["Missing required --prompt"] });

  console.log("CLI smoke checks passed.");
}

main();

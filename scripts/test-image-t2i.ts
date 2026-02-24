#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type CliArgs = {
  token?: string;
  prompt: string;
  url: string;
  model: string;
  ratio: string;
  resolution: string;
  outputDir: string;
};

type ApiResponsePayload = {
  code?: number;
  message?: string;
  data?: Array<{ url?: string }>;
};

type SessionPoolData = {
  tokens?: unknown[];
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_PROMPT = "测试文生图：一只橘猫坐在窗边，清晨阳光，写实风格";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    prompt: DEFAULT_PROMPT,
    url: "http://127.0.0.1:5100",
    model: "jimeng-4.5",
    ratio: "1:1",
    resolution: "2k",
    outputDir: "./pic/test-text-image",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--")) continue;

    switch (key) {
      case "--token":
        args.token = value;
        i += 1;
        break;
      case "--prompt":
        args.prompt = value;
        i += 1;
        break;
      case "--url":
        args.url = value;
        i += 1;
        break;
      case "--model":
        args.model = value;
        i += 1;
        break;
      case "--ratio":
        args.ratio = value;
        i += 1;
        break;
      case "--resolution":
        args.resolution = value;
        i += 1;
        break;
      case "--output-dir":
        args.outputDir = value;
        i += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

function usage(): string {
  return [
    "Usage:",
    "  tsx scripts/test-image-t2i.ts [options]",
    "",
    "Options:",
    "  --token <session_token>    可选：优先级最高",
    "  --prompt <text>            默认: 测试文生图：一只橘猫坐在窗边，清晨阳光，写实风格",
    "  --url <base_url>          API 地址，默认 http://127.0.0.1:5100",
    "  --model <model>           默认 jimeng-4.5",
    "  --ratio <ratio>           默认 1:1",
    "  --resolution <resolution> 默认 2k",
    "  --output-dir <dir>        默认 ./pic/test-text-image",
    "",
    "Token source priority:",
    "  1) --token",
    "  2) TEST_SESSION_ID 环境变量",
    "  3) configs/session-pool.json 的第一个 token",
  ].join("\n");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveToken(cliToken?: string): Promise<string | undefined> {
  if (cliToken && cliToken.trim().length > 0) return cliToken.trim();

  const fromEnv = process.env.TEST_SESSION_ID?.trim();
  if (fromEnv) return fromEnv;

  const poolPath = path.resolve(PROJECT_ROOT, "configs/session-pool.json");
  if (!(await pathExists(poolPath))) return undefined;
  const raw = await readFile(poolPath, "utf8");
  const parsed = JSON.parse(raw) as SessionPoolData;
  const first = Array.isArray(parsed.tokens)
    ? parsed.tokens.find((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  return first?.trim();
}

function detectExtensionFromContentType(contentType: string | null): string {
  if (!contentType) return "bin";
  if (contentType.includes("image/jpeg")) return "jpg";
  if (contentType.includes("image/png")) return "png";
  if (contentType.includes("image/webp")) return "webp";
  if (contentType.includes("image/gif")) return "gif";
  return "bin";
}

async function downloadFile(fileUrl: string, outputPath: string): Promise<void> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`下载失败 ${response.status}: ${fileUrl}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await writeFile(outputPath, Buffer.from(arrayBuffer));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const token = await resolveToken(args.token);
  if (!token) {
    throw new Error(`未找到可用 token。\n请使用 --token、设置 TEST_SESSION_ID，或在 configs/session-pool.json 写入 tokens。\n\n${usage()}`);
  }

  const endpoint = `${args.url.replace(/\/$/, "")}/v1/images/generations`;
  console.log(`Calling: ${endpoint}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: args.prompt,
      model: args.model,
      ratio: args.ratio,
      resolution: args.resolution,
    }),
  });

  const responseText = await response.text();
  let payload: ApiResponsePayload = {};
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (parsed && typeof parsed === "object") {
      payload = parsed as ApiResponsePayload;
    }
  } catch {
    throw new Error(`接口返回非 JSON: ${responseText.slice(0, 500)}`);
  }

  if (!response.ok) {
    throw new Error(`接口请求失败 ${response.status}: ${JSON.stringify(payload)}`);
  }
  if (typeof payload.code === "number" && payload.code !== 0) {
    throw new Error(payload.message || `业务失败: code=${payload.code}`);
  }

  const urls = Array.isArray(payload?.data)
    ? payload.data.map((item) => item?.url).filter((item): item is string => typeof item === "string")
    : [];

  if (urls.length === 0) {
    throw new Error(`响应中未找到图片 URL: ${JSON.stringify(payload)}`);
  }

  const outputDir = path.resolve(args.outputDir);
  await mkdir(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const downloaded: string[] = [];

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    const probe = await fetch(url, { method: "HEAD" });
    const ext = detectExtensionFromContentType(probe.headers.get("content-type"));
    const fileName = `text-image-test-${timestamp}-${String(i + 1).padStart(2, "0")}.${ext}`;
    const outputPath = path.join(outputDir, fileName);
    await downloadFile(url, outputPath);
    downloaded.push(outputPath);
  }

  console.log(`Success: downloaded ${downloaded.length} image(s).`);
  downloaded.forEach((file) => {
    console.log(`- ${file}`);
  });
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

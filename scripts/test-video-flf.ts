#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type CliArgs = {
  token?: string;
  prompt: string;
  image: string;
  image2?: string;
  url: string;
  model: string;
  duration: string;
  ratio: string;
  resolution: string;
  outputDir: string;
};

type VideoResponsePayload = {
  code?: number;
  message?: string;
  data?: Array<{
    url?: string;
    video?: { url?: string };
    video_url?: string;
    download_url?: string;
  }>;
  url?: string;
};

type SessionPoolData = {
  tokens?: unknown[];
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_IMAGE = "./scripts/fixtures/sample-input-image.png";
const DEFAULT_PROMPT = "测试图生视频：让画面主体产生自然动作";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    prompt: DEFAULT_PROMPT,
    image: DEFAULT_IMAGE,
    url: "http://127.0.0.1:5100",
    model: "jimeng-video-3.0",
    duration: "5",
    ratio: "1:1",
    resolution: "720p",
    outputDir: "./pic/test-video",
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
      case "--image":
        args.image = value;
        i += 1;
        break;
      case "--image2":
        args.image2 = value;
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
      case "--duration":
        args.duration = value;
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
    "  tsx scripts/test-video-flf.ts [options]",
    "",
    "Options:",
    "  --token <session_token>    可选：优先级最高",
    "  --prompt <text>            默认: 测试图生视频：让画面主体产生自然动作",
    "  --image <path>             默认: ./scripts/fixtures/sample-input-image.png",
    "  --image2 <path>          可选，尾帧图片",
    "  --url <base_url>         API 地址，默认 http://127.0.0.1:5100",
    "  --model <model>          默认 jimeng-video-3.0",
    "  --duration <seconds>     默认 5",
    "  --ratio <ratio>          默认 1:1",
    "  --resolution <res>       默认 720p",
    "  --output-dir <dir>       默认 ./pic/test-video",
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

async function ensureFixtureImage(imagePath: string): Promise<void> {
  const defaultImagePath = path.resolve(PROJECT_ROOT, DEFAULT_IMAGE);
  if (imagePath !== defaultImagePath) {
    if (await pathExists(imagePath)) return;
    throw new Error(`图片不存在: ${imagePath}`);
  }

  const b64Path = `${defaultImagePath}.base64`;
  if (!(await pathExists(b64Path))) {
    throw new Error(`默认测试图片缺失: ${defaultImagePath}`);
  }

  if (await pathExists(defaultImagePath)) {
    const existing = await readFile(defaultImagePath);
    const width = existing.readUInt32BE(16);
    const height = existing.readUInt32BE(20);
    // 1x1 这类极小图容易导致图生视频失败，自动重建默认图。
    if (width >= 64 && height >= 64) return;
  }

  const b64 = (await readFile(b64Path, "utf8")).trim();
  const binary = Buffer.from(b64, "base64");
  await mkdir(path.dirname(defaultImagePath), { recursive: true });
  await writeFile(defaultImagePath, binary);
}

function detectMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function detectVideoExtension(contentType: string | null, fileUrl: string): string {
  if (contentType?.includes("video/mp4")) return "mp4";
  if (contentType?.includes("video/webm")) return "webm";
  const pathname = new URL(fileUrl).pathname.toLowerCase();
  if (pathname.endsWith(".mp4")) return "mp4";
  if (pathname.endsWith(".webm")) return "webm";
  if (pathname.endsWith(".mov")) return "mov";
  return "mp4";
}

function extractVideoUrl(payload: VideoResponsePayload): string | null {
  const directUrl = payload?.data?.[0]?.url;
  if (typeof directUrl === "string" && directUrl.length > 0) return directUrl;

  const nested =
    payload?.data?.[0]?.video?.url ??
    payload?.data?.[0]?.video_url ??
    payload?.data?.[0]?.download_url ??
    payload?.url;
  if (typeof nested === "string" && nested.length > 0) return nested;

  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const token = await resolveToken(args.token);
  if (!token) {
    throw new Error(`未找到可用 token。\n请使用 --token、设置 TEST_SESSION_ID，或在 configs/session-pool.json 写入 tokens。\n\n${usage()}`);
  }

  const image1Path = path.resolve(args.image);
  await ensureFixtureImage(image1Path);
  const image1Buffer = await readFile(image1Path);

  const form = new FormData();
  form.append("prompt", args.prompt);
  form.append("model", args.model);
  form.append("duration", args.duration);
  form.append("ratio", args.ratio);
  form.append("resolution", args.resolution);
  form.append("image_file_1", new Blob([image1Buffer], { type: detectMime(image1Path) }), path.basename(image1Path));

  if (args.image2) {
    const image2Path = path.resolve(args.image2);
    const image2Buffer = await readFile(image2Path);
    form.append("image_file_2", new Blob([image2Buffer], { type: detectMime(image2Path) }), path.basename(image2Path));
  }

  const endpoint = `${args.url.replace(/\/$/, "")}/v1/videos/generations`;
  console.log(`Calling: ${endpoint}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const responseText = await response.text();
  let payload: VideoResponsePayload = {};
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (parsed && typeof parsed === "object") {
      payload = parsed as VideoResponsePayload;
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

  const videoUrl = extractVideoUrl(payload);
  if (!videoUrl) {
    throw new Error(`响应中未找到视频 URL: ${JSON.stringify(payload)}`);
  }

  const fileResponse = await fetch(videoUrl);
  if (!fileResponse.ok) {
    throw new Error(`下载视频失败 ${fileResponse.status}: ${videoUrl}`);
  }

  const outputDir = path.resolve(args.outputDir);
  await mkdir(outputDir, { recursive: true });

  const ext = detectVideoExtension(fileResponse.headers.get("content-type"), videoUrl);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const filePath = path.join(outputDir, `video-test-${timestamp}.${ext}`);

  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  await writeFile(filePath, buffer);

  console.log("Success: video downloaded.");
  console.log(`- ${filePath}`);
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

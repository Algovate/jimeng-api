#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import minimist from "minimist";

const DEFAULT_BASE_URL = "http://127.0.0.1:5100";

type JsonRecord = Record<string, unknown>;

function usageRoot(): string {
  return [
    "Usage:",
    "  jimeng <command> [subcommand] [options]",
    "",
    "Commands:",
    "  serve                            Start jimeng-api service",
    "  models list                      List available models",
    "  token check                      Validate session ids via /token/check",
    "  image generate                   Generate image from text",
    "  image edit                       Edit image(s) with prompt",
    "  video generate                   Generate video from image(s)",
    "",
    "Run `jimeng <command> --help` for command details.",
  ].join("\n");
}

function usageModelsList(): string {
  return [
    "Usage:",
    "  jimeng models list [options]",
    "",
    "Options:",
    "  --base-url <url>         API base URL, default http://127.0.0.1:5100",
    "  --verbose                Print rich model fields",
    "  --json                   Print full JSON response",
    "  --help                   Show help",
  ].join("\n");
}

function usageTokenCheck(): string {
  return [
    "Usage:",
    "  jimeng token check [options]",
    "",
    "Options:",
    "  --session-id <id>        Session id, can be repeated",
    "  --session-file <path>    Read session ids from file (one per line, # for comments)",
    "  --base-url <url>         API base URL, default http://127.0.0.1:5100",
    "  --help                   Show help",
    "",
    "Env:",
    "  JIMENG_SESSION_IDS       Comma-separated session ids (used when args not provided)",
  ].join("\n");
}

function usageImageGenerate(): string {
  return [
    "Usage:",
    "  jimeng image generate --session-id <id> --prompt <text> [options]",
    "",
    "Options:",
    "  --session-id <id>        Required",
    "  --prompt <text>          Required",
    "  --model <model>          Default jimeng-4.5",
    "  --ratio <ratio>          Default 1:1",
    "  --resolution <res>       Default 2k",
    "  --negative-prompt <text> Optional",
    "  --sample-strength <num>  Optional, 0-1",
    "  --intelligent-ratio      Optional, enable intelligent ratio",
    "  --base-url <url>         API base URL, default http://127.0.0.1:5100",
    "  --output-dir <dir>       Default ./pic/cli-image-generate",
    "  --help                   Show help",
  ].join("\n");
}

function usageImageEdit(): string {
  return [
    "Usage:",
    "  jimeng image edit --session-id <id> --prompt <text> --image <path_or_url> [--image <path_or_url> ...] [options]",
    "",
    "Options:",
    "  --session-id <id>        Required",
    "  --prompt <text>          Required",
    "  --image <path_or_url>    Required, can be repeated (1-10)",
    "  --model <model>          Default jimeng-4.5",
    "  --ratio <ratio>          Default 1:1",
    "  --resolution <res>       Default 2k",
    "  --negative-prompt <text> Optional",
    "  --sample-strength <num>  Optional, 0-1",
    "  --intelligent-ratio      Optional, enable intelligent ratio",
    "  --base-url <url>         API base URL, default http://127.0.0.1:5100",
    "  --output-dir <dir>       Default ./pic/cli-image-edit",
    "  --help                   Show help",
    "",
    "Notes:",
    "  - Image sources must be all local files or all URLs in one command.",
  ].join("\n");
}

function usageVideoGenerate(): string {
  return [
    "Usage:",
    "  jimeng video generate --session-id <id> --prompt <text> --image <path> [options]",
    "",
    "Options:",
    "  --session-id <id>        Required",
    "  --prompt <text>          Required",
    "  --image <path>           Required, first frame",
    "  --image2 <path>          Optional, last frame",
    "  --model <model>          Default jimeng-video-3.0",
    "  --ratio <ratio>          Default 1:1",
    "  --resolution <res>       Default 720p",
    "  --duration <seconds>     Default 5",
    "  --base-url <url>         API base URL, default http://127.0.0.1:5100",
    "  --output-dir <dir>       Default ./pic/cli-video-generate",
    "  --help                   Show help",
  ].join("\n");
}

function fail(message: string): never {
  throw new Error(message);
}

function getSingleString(args: Record<string, unknown>, key: string): string | undefined {
  const raw = args[key];
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return undefined;
}

function toStringList(raw: unknown): string[] {
  if (typeof raw === "string") return raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(raw)) {
    return raw
      .flatMap((item) => (typeof item === "string" ? item.split(",") : []))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function sanitizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function maskSessionId(sessionId: string): string {
  const n = sessionId.length;
  if (n <= 10) return "***";
  return `${sessionId.slice(0, 4)}...${sessionId.slice(-4)}`;
}

function ensurePrompt(prompt: string | undefined, usage: string): string {
  if (!prompt) {
    fail(`Missing required --prompt.\n\n${usage}`);
  }
  return prompt;
}

function ensureSessionId(sessionId: string | undefined, usage: string): string {
  if (!sessionId) {
    fail(`Missing required --session-id.\n\n${usage}`);
  }
  return sessionId;
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function detectImageMime(filePath: string): string {
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

function detectImageExtension(contentType: string | null): string {
  if (!contentType) return "bin";
  if (contentType.includes("image/jpeg")) return "jpg";
  if (contentType.includes("image/png")) return "png";
  if (contentType.includes("image/webp")) return "webp";
  if (contentType.includes("image/gif")) return "gif";
  return "bin";
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

function unwrapBody(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const body = payload as JsonRecord;
  if ("data" in body && ("code" in body || "message" in body)) {
    return body.data;
  }
  return payload;
}

function assertBusinessSuccess(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const body = payload as JsonRecord;
  if (typeof body.code === "number" && body.code !== 0) {
    const msg = typeof body.message === "string" ? body.message : `Business error: code=${body.code}`;
    fail(msg);
  }
}

async function requestJson(
  endpoint: string,
  init: RequestInit
): Promise<{ payload: unknown }> {
  const response = await fetch(endpoint, init);
  const text = await response.text();

  let payload: unknown = {};
  try {
    payload = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    fail(`Non-JSON response (${response.status}): ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    fail(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  assertBusinessSuccess(payload);
  return { payload };
}

function collectImageUrls(payload: unknown): string[] {
  const normalized = unwrapBody(payload);
  if (normalized && typeof normalized === "object") {
    const data = (normalized as JsonRecord).data;
    if (Array.isArray(data)) {
      return data
        .map((item) => (item && typeof item === "object" ? (item as JsonRecord).url : undefined))
        .filter((url): url is string => typeof url === "string" && url.length > 0);
    }
  }
  return [];
}

function collectVideoUrl(payload: unknown): string | null {
  const normalized = unwrapBody(payload);
  if (!normalized || typeof normalized !== "object") return null;

  const first = Array.isArray((normalized as JsonRecord).data)
    ? ((normalized as JsonRecord).data as unknown[])[0]
    : undefined;
  if (!first || typeof first !== "object") return null;

  const firstObj = first as JsonRecord;
  const direct = firstObj.url;
  if (typeof direct === "string" && direct.length > 0) return direct;

  const nestedVideo = firstObj.video;
  if (nestedVideo && typeof nestedVideo === "object") {
    const nestedUrl = (nestedVideo as JsonRecord).url;
    if (typeof nestedUrl === "string" && nestedUrl.length > 0) return nestedUrl;
  }

  const videoUrl = firstObj.video_url;
  if (typeof videoUrl === "string" && videoUrl.length > 0) return videoUrl;

  const downloadUrl = firstObj.download_url;
  if (typeof downloadUrl === "string" && downloadUrl.length > 0) return downloadUrl;

  return null;
}

async function downloadBinary(url: string): Promise<{ buffer: Buffer; contentType: string | null }> {
  const response = await fetch(url);
  if (!response.ok) {
    fail(`Download failed (${response.status}): ${url}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
  };
}

async function downloadImages(urls: string[], outputDir: string, prefix: string): Promise<string[]> {
  const dir = path.resolve(outputDir);
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const saved: string[] = [];

  for (let i = 0; i < urls.length; i += 1) {
    const imageUrl = urls[i];
    const probe = await fetch(imageUrl, { method: "HEAD" });
    const ext = detectImageExtension(probe.headers.get("content-type"));
    const fileName = `${prefix}-${timestamp}-${String(i + 1).padStart(2, "0")}.${ext}`;
    const filePath = path.join(dir, fileName);
    const { buffer } = await downloadBinary(imageUrl);
    await writeFile(filePath, buffer);
    saved.push(filePath);
  }

  return saved;
}

async function handleTokenCheck(argv: string[]): Promise<void> {
  const args = minimist(argv, {
    string: ["session-id", "session-file", "base-url"],
    boolean: ["help"],
  });

  if (args.help) {
    console.log(usageTokenCheck());
    return;
  }

  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const fromArgs = toStringList(args["session-id"]);
  const fromEnv = (process.env.JIMENG_SESSION_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const tokens = [...fromArgs];

  const sessionFile = getSingleString(args, "session-file");
  if (sessionFile) {
    const filePath = path.resolve(sessionFile);
    if (!(await pathExists(filePath))) {
      fail(`Session file not found: ${filePath}`);
    }
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      tokens.push(trimmed);
    });
  }

  if (tokens.length === 0) {
    tokens.push(...fromEnv);
  }

  if (tokens.length === 0) {
    fail(`No session ids provided.\n\n${usageTokenCheck()}`);
  }

  console.log(`Checking ${tokens.length} session id(s) against ${baseUrl}/token/check`);

  let invalid = 0;
  let requestErrors = 0;

  for (const token of tokens) {
    try {
      const { payload } = await requestJson(`${baseUrl}/token/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const normalized = unwrapBody(payload);
      const live =
        normalized && typeof normalized === "object" ? (normalized as JsonRecord).live : undefined;
      if (live === true) {
        console.log(`[OK]   ${maskSessionId(token)} live=true`);
      } else {
        invalid += 1;
        console.log(`[FAIL] ${maskSessionId(token)} live=false`);
      }
    } catch (error) {
      requestErrors += 1;
      console.log(
        `[ERROR] ${maskSessionId(token)} ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  console.log(`Summary: total=${tokens.length} invalid=${invalid} request_errors=${requestErrors}`);

  if (requestErrors > 0) process.exit(3);
  if (invalid > 0) process.exit(2);
}

async function handleModelsList(argv: string[]): Promise<void> {
  const args = minimist(argv, {
    string: ["base-url"],
    boolean: ["help", "json", "verbose"],
  });

  if (args.help) {
    console.log(usageModelsList());
    return;
  }

  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const endpoint = `${baseUrl}/v1/models`;
  const { payload } = await requestJson(endpoint, { method: "GET" });
  const normalized = unwrapBody(payload);

  if (args.json) {
    console.log(JSON.stringify(normalized, null, 2));
    return;
  }

  const data =
    normalized && typeof normalized === "object" && Array.isArray((normalized as JsonRecord).data)
      ? ((normalized as JsonRecord).data as unknown[])
      : [];

  if (data.length === 0) {
    fail(`No models found in response: ${JSON.stringify(normalized)}`);
  }

  if (args.verbose) {
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const model = item as JsonRecord;
      const id = typeof model.id === "string" ? model.id : "";
      if (!id) continue;
      const modelType = typeof model.model_type === "string" ? model.model_type : "-";
      const description = typeof model.description === "string" ? model.description : "-";
      const capabilities = Array.isArray(model.capabilities)
        ? model.capabilities.filter((cap): cap is string => typeof cap === "string").join(",")
        : "-";
      console.log(`${id}\ttype=${modelType}\tdesc=${description}\tcapabilities=${capabilities}`);
    }
    return;
  }

  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const id = (item as JsonRecord).id;
    if (typeof id === "string" && id.length > 0) {
      console.log(id);
    }
  }
}

async function handleImageGenerate(argv: string[]): Promise<void> {
  const args = minimist(argv, {
    string: [
      "session-id",
      "prompt",
      "model",
      "ratio",
      "resolution",
      "negative-prompt",
      "sample-strength",
      "base-url",
      "output-dir",
    ],
    boolean: ["help", "intelligent-ratio"],
  });

  if (args.help) {
    console.log(usageImageGenerate());
    return;
  }

  const sessionId = ensureSessionId(getSingleString(args, "session-id"), usageImageGenerate());
  const prompt = ensurePrompt(getSingleString(args, "prompt"), usageImageGenerate());
  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const outputDir = getSingleString(args, "output-dir") || "./pic/cli-image-generate";

  const body: JsonRecord = {
    prompt,
    model: getSingleString(args, "model") || "jimeng-4.5",
    ratio: getSingleString(args, "ratio") || "1:1",
    resolution: getSingleString(args, "resolution") || "2k",
  };

  const negativePrompt = getSingleString(args, "negative-prompt");
  if (negativePrompt) body.negative_prompt = negativePrompt;

  if (args["intelligent-ratio"]) {
    body.intelligent_ratio = true;
  }

  const sampleStrengthRaw = getSingleString(args, "sample-strength");
  if (sampleStrengthRaw) {
    const parsed = Number(sampleStrengthRaw);
    if (!Number.isFinite(parsed)) {
      fail(`Invalid --sample-strength: ${sampleStrengthRaw}`);
    }
    body.sample_strength = parsed;
  }

  const endpoint = `${baseUrl}/v1/images/generations`;
  console.log(`Calling: ${endpoint}`);
  const { payload } = await requestJson(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionId}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const urls = collectImageUrls(payload);
  if (urls.length === 0) {
    fail(`No image URL found in response: ${JSON.stringify(payload)}`);
  }

  const savedFiles = await downloadImages(urls, outputDir, "jimeng-image-generate");
  console.log(`Success: downloaded ${savedFiles.length} image(s).`);
  savedFiles.forEach((file) => {
    console.log(`- ${file}`);
  });
}

async function handleImageEdit(argv: string[]): Promise<void> {
  const args = minimist(argv, {
    string: [
      "session-id",
      "prompt",
      "image",
      "model",
      "ratio",
      "resolution",
      "negative-prompt",
      "sample-strength",
      "base-url",
      "output-dir",
    ],
    boolean: ["help", "intelligent-ratio"],
  });

  if (args.help) {
    console.log(usageImageEdit());
    return;
  }

  const sessionId = ensureSessionId(getSingleString(args, "session-id"), usageImageEdit());
  const prompt = ensurePrompt(getSingleString(args, "prompt"), usageImageEdit());
  const sources = toStringList(args.image);
  if (sources.length === 0) {
    fail(`Missing required --image.\n\n${usageImageEdit()}`);
  }
  if (sources.length > 10) {
    fail("At most 10 images are supported for image edit.");
  }

  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const outputDir = getSingleString(args, "output-dir") || "./pic/cli-image-edit";
  const model = getSingleString(args, "model") || "jimeng-4.5";
  const ratio = getSingleString(args, "ratio") || "1:1";
  const resolution = getSingleString(args, "resolution") || "2k";
  const negativePrompt = getSingleString(args, "negative-prompt");
  const sampleStrengthRaw = getSingleString(args, "sample-strength");
  const intelligentRatio = Boolean(args["intelligent-ratio"]);

  const allUrls = sources.every(isHttpUrl);
  const allLocal = sources.every((item) => !isHttpUrl(item));
  if (!allUrls && !allLocal) {
    fail("Mixed image sources are not supported. Use all URLs or all local files.");
  }

  const endpoint = `${baseUrl}/v1/images/compositions`;
  console.log(`Calling: ${endpoint}`);

  let payload: unknown = {};
  if (allUrls) {
    const body: JsonRecord = {
      prompt,
      model,
      ratio,
      resolution,
      images: sources,
    };
    if (negativePrompt) body.negative_prompt = negativePrompt;
    if (intelligentRatio) body.intelligent_ratio = true;
    if (sampleStrengthRaw) {
      const parsed = Number(sampleStrengthRaw);
      if (!Number.isFinite(parsed)) {
        fail(`Invalid --sample-strength: ${sampleStrengthRaw}`);
      }
      body.sample_strength = parsed;
    }

    const result = await requestJson(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    payload = result.payload;
  } else {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("model", model);
    form.append("ratio", ratio);
    form.append("resolution", resolution);
    if (negativePrompt) form.append("negative_prompt", negativePrompt);
    if (intelligentRatio) form.append("intelligent_ratio", "true");
    if (sampleStrengthRaw) {
      const parsed = Number(sampleStrengthRaw);
      if (!Number.isFinite(parsed)) {
        fail(`Invalid --sample-strength: ${sampleStrengthRaw}`);
      }
      form.append("sample_strength", String(parsed));
    }

    for (const source of sources) {
      const imagePath = path.resolve(source);
      if (!(await pathExists(imagePath))) {
        fail(`Image file not found: ${imagePath}`);
      }
      const imageBuffer = await readFile(imagePath);
      form.append(
        "images",
        new Blob([imageBuffer], { type: detectImageMime(imagePath) }),
        path.basename(imagePath)
      );
    }

    const result = await requestJson(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionId}` },
      body: form,
    });
    payload = result.payload;
  }

  const urls = collectImageUrls(payload);
  if (urls.length === 0) {
    fail(`No image URL found in response: ${JSON.stringify(payload)}`);
  }

  const savedFiles = await downloadImages(urls, outputDir, "jimeng-image-edit");
  console.log(`Success: downloaded ${savedFiles.length} image(s).`);
  savedFiles.forEach((file) => {
    console.log(`- ${file}`);
  });
}

async function handleVideoGenerate(argv: string[]): Promise<void> {
  const args = minimist(argv, {
    string: [
      "session-id",
      "prompt",
      "image",
      "image2",
      "model",
      "ratio",
      "resolution",
      "duration",
      "base-url",
      "output-dir",
    ],
    boolean: ["help"],
  });

  if (args.help) {
    console.log(usageVideoGenerate());
    return;
  }

  const sessionId = ensureSessionId(getSingleString(args, "session-id"), usageVideoGenerate());
  const prompt = ensurePrompt(getSingleString(args, "prompt"), usageVideoGenerate());
  const image = getSingleString(args, "image");
  if (!image) {
    fail(`Missing required --image.\n\n${usageVideoGenerate()}`);
  }

  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const outputDir = getSingleString(args, "output-dir") || "./pic/cli-video-generate";
  const model = getSingleString(args, "model") || "jimeng-video-3.0";
  const ratio = getSingleString(args, "ratio") || "1:1";
  const resolution = getSingleString(args, "resolution") || "720p";
  const duration = getSingleString(args, "duration") || "5";

  const imagePath = path.resolve(image);
  if (!(await pathExists(imagePath))) {
    fail(`Image file not found: ${imagePath}`);
  }

  const form = new FormData();
  form.append("prompt", prompt);
  form.append("model", model);
  form.append("ratio", ratio);
  form.append("resolution", resolution);
  form.append("duration", duration);

  const imageBuffer = await readFile(imagePath);
  form.append(
    "image_file_1",
    new Blob([imageBuffer], { type: detectImageMime(imagePath) }),
    path.basename(imagePath)
  );

  const image2 = getSingleString(args, "image2");
  if (image2) {
    const imagePath2 = path.resolve(image2);
    if (!(await pathExists(imagePath2))) {
      fail(`Image file not found: ${imagePath2}`);
    }
    const imageBuffer2 = await readFile(imagePath2);
    form.append(
      "image_file_2",
      new Blob([imageBuffer2], { type: detectImageMime(imagePath2) }),
      path.basename(imagePath2)
    );
  }

  const endpoint = `${baseUrl}/v1/videos/generations`;
  console.log(`Calling: ${endpoint}`);
  const { payload } = await requestJson(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionId}` },
    body: form,
  });

  const videoUrl = collectVideoUrl(payload);
  if (!videoUrl) {
    fail(`No video URL found in response: ${JSON.stringify(payload)}`);
  }

  const { buffer, contentType } = await downloadBinary(videoUrl);
  const dir = path.resolve(outputDir);
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const ext = detectVideoExtension(contentType, videoUrl);
  const filePath = path.join(dir, `jimeng-video-generate-${timestamp}.${ext}`);
  await writeFile(filePath, buffer);

  console.log("Success: video downloaded.");
  console.log(`- ${filePath}`);
}

async function run(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(usageRoot());
    return;
  }

  if (command === "serve") {
    const { startService } = await import("../lib/start-service.ts");
    await startService();
    return;
  }

  if (command === "token" && subcommand === "check") {
    await handleTokenCheck(rest);
    return;
  }

  if (command === "models" && subcommand === "list") {
    await handleModelsList(rest);
    return;
  }

  if (command === "image" && subcommand === "generate") {
    await handleImageGenerate(rest);
    return;
  }

  if (command === "image" && subcommand === "edit") {
    await handleImageEdit(rest);
    return;
  }

  if (command === "video" && subcommand === "generate") {
    await handleVideoGenerate(rest);
    return;
  }

  fail(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}\n\n${usageRoot()}`);
}

run().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

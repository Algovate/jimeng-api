#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import minimist from "minimist";

const DEFAULT_BASE_URL = "http://127.0.0.1:5100";

type JsonRecord = Record<string, unknown>;
type CliHandler = (argv: string[]) => Promise<void>;
type UsageSection = { title: string; lines: string[] };

const BASE_URL_OPTION = "  --base-url <url>         API base URL, default http://127.0.0.1:5100";
const HELP_OPTION = "  --help                   Show help";

function buildUsageText(
  usageLine: string,
  options: string[],
  sections?: UsageSection[]
): string {
  const lines = [
    "Usage:",
    usageLine,
    "",
    "Options:",
    ...options,
  ];
  if (sections && sections.length > 0) {
    for (const section of sections) {
      lines.push("", section.title, ...section.lines);
    }
  }
  return lines.join("\n");
}

function usageRoot(): string {
  const commandLines = ROOT_COMMAND_ENTRIES.map(
    (entry) => `  ${entry.path.padEnd(32)}${entry.description}`
  );
  return [
    "Usage:",
    "  jimeng <command> [subcommand] [options]",
    "",
    "Commands:",
    ...commandLines,
    "",
    ...ROOT_HELP_HINT_LINES,
  ].join("\n");
}

function usageModelsList(): string {
  return buildUsageText("  jimeng models list [options]", [
    "  --base-url <url>         API base URL, default http://127.0.0.1:5100",
    "  --verbose                Print rich model fields",
    "  --json                   Print full JSON response",
    HELP_OPTION,
  ]);
}

function usageTokenSubcommand(name: TokenSubcommandName): string {
  const subcommand = TOKEN_SUBCOMMANDS_BY_NAME[name];
  return buildUsageText(subcommand.usageLine, subcommand.options, subcommand.sections);
}

function usageTokenRoot(): string {
  const subcommandLines = TOKEN_SUBCOMMANDS.map(
    (subcommand) => `  ${subcommand.name.padEnd(24)}${subcommand.description}`
  );
  return [
    "Usage:",
    "  jimeng token <subcommand> [options]",
    "",
    "Subcommands:",
    ...subcommandLines,
    "",
    "Run `jimeng token <subcommand> --help` for details.",
  ].join("\n");
}

function usageImageGenerate(): string {
  return buildUsageText("  jimeng image generate --prompt <text> [options]", [
    "  --token <token>          Optional, override server token-pool",
    "  --prompt <text>          Required",
    "  --model <model>          Default jimeng-4.5",
    "  --ratio <ratio>          Default 1:1",
    "  --resolution <res>       Default 2k",
    "  --negative-prompt <text> Optional",
    "  --sample-strength <num>  Optional, 0-1",
    "  --intelligent-ratio      Optional, enable intelligent ratio",
    BASE_URL_OPTION,
    "  --output-dir <dir>       Default ./pic/cli-image-generate",
    HELP_OPTION,
  ]);
}

function usageImageEdit(): string {
  return buildUsageText(
    "  jimeng image edit --prompt <text> --image <path_or_url> [--image <path_or_url> ...] [options]",
    [
    "  --token <token>          Optional, override server token-pool",
    "  --prompt <text>          Required",
    "  --image <path_or_url>    Required, can be repeated (1-10)",
    "  --model <model>          Default jimeng-4.5",
    "  --ratio <ratio>          Default 1:1",
    "  --resolution <res>       Default 2k",
    "  --negative-prompt <text> Optional",
    "  --sample-strength <num>  Optional, 0-1",
    "  --intelligent-ratio      Optional, enable intelligent ratio",
    BASE_URL_OPTION,
    "  --output-dir <dir>       Default ./pic/cli-image-edit",
    HELP_OPTION,
    ],
    [
      {
        title: "Notes:",
        lines: ["  - Image sources must be all local files or all URLs in one command."],
      },
    ]
  );
}

function usageVideoGenerate(): string {
  return buildUsageText("  jimeng video generate --prompt <text> [options]", [
    "  --token <token>          Optional, override server token-pool",
    "  --prompt <text>          Required",
    "  --mode <mode>            Optional, text_to_video (default), image_to_video, first_last_frames, or omni_reference",
    "  --image-file <input>     Image input, can be repeated (path or URL)",
    "  --video-file <input>     Video input, can be repeated (path or URL, omni only)",
    "  --image-file-1 <input>   Explicit image slot (1-9) for omni_reference",
    "  --image-file-2 ... -9    More explicit image slots for omni_reference",
    "  --video-file-1 <input>   Explicit video slot (1-3) for omni_reference",
    "  --video-file-2 ... -3    More explicit video slots for omni_reference",
    "  --model <model>          Default jimeng-video-3.0 (jimeng-video-seedance-2.0-fast in omni_reference)",
    "  --ratio <ratio>          Default 1:1",
    "  --resolution <res>       Default 720p",
    "  --duration <seconds>     Default 5",
    BASE_URL_OPTION,
    "  --output-dir <dir>       Default ./pic/cli-video-generate",
    HELP_OPTION,
  ], [
    {
      title: "Examples:",
      lines: [
        "  jimeng video generate --mode text_to_video --prompt \"A fox runs in snow\"",
        "  jimeng video generate --mode image_to_video --prompt \"Camera slowly pushes in\" --image-file ./first.png",
        "  jimeng video generate --mode first_last_frames --prompt \"Transition day to night\" --image-file ./first.png --image-file ./last.png",
        "  jimeng video generate --mode omni_reference --model jimeng-video-seedance-2.0-fast --prompt \"Use @image_file_1 for character and @video_file_1 for motion\" --image-file ./character.png --video-file ./motion.mp4",
      ],
    },
    {
      title: "Notes:",
      lines: [
        "  - text_to_video: no image/video input allowed.",
        "  - image_to_video: exactly 1 --image-file input, no --video-file.",
        "  - first_last_frames: 1-2 --image-file inputs, no --video-file.",
        "  - omni_reference: 1-9 images and 0-3 videos (at least one material).",
        "  - omni_reference supports model jimeng-video-seedance-2.0 or jimeng-video-seedance-2.0-fast.",
        "  - Use @image_file_N / @video_file_N in prompt for omni_reference.",
      ],
    },
  ]);
}

function fail(message: string): never {
  throw new Error(message);
}

function failWithUsage(reason: string, usage: string): never {
  fail(`${reason}\n\n${usage}`);
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

function maskToken(token: string): string {
  const n = token.length;
  if (n <= 10) return "***";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function ensurePrompt(prompt: string | undefined, usage: string): string {
  if (!prompt) {
    fail(`Missing required --prompt.\n\n${usage}`);
  }
  return prompt;
}

function buildAuthHeaders(token: string | undefined): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
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

function detectVideoUploadMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".m4v":
      return "video/x-m4v";
    default:
      return "application/octet-stream";
  }
}

function detectImageExtension(contentType: string | null): string | null {
  if (!contentType) return null;
  if (contentType.includes("image/jpeg")) return "jpg";
  if (contentType.includes("image/png")) return "png";
  if (contentType.includes("image/webp")) return "webp";
  if (contentType.includes("image/gif")) return "gif";
  return null;
}

function detectImageExtensionFromUrl(fileUrl: string): string | null {
  try {
    const pathname = new URL(fileUrl).pathname.toLowerCase();
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "jpg";
    if (pathname.endsWith(".png")) return "png";
    if (pathname.endsWith(".webp")) return "webp";
    if (pathname.endsWith(".gif")) return "gif";
  } catch {
    return null;
  }
  return null;
}

function detectImageExtensionFromBuffer(buffer: Buffer): string | null {
  if (buffer.length >= 8) {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return "png";
    }
  }
  if (buffer.length >= 3) {
    // JPEG signature: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "jpg";
    }
  }
  if (buffer.length >= 12) {
    // WebP signature: RIFF....WEBP
    if (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      return "webp";
    }
  }
  if (buffer.length >= 6) {
    const sig = buffer.toString("ascii", 0, 6);
    if (sig === "GIF87a" || sig === "GIF89a") {
      return "gif";
    }
  }
  return null;
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
    const { buffer, contentType } = await downloadBinary(imageUrl);
    const ext =
      detectImageExtension(contentType) ??
      detectImageExtensionFromBuffer(buffer) ??
      detectImageExtensionFromUrl(imageUrl) ??
      "png";
    const fileName = `${prefix}-${timestamp}-${String(i + 1).padStart(2, "0")}.${ext}`;
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, buffer);
    saved.push(filePath);
  }

  return saved;
}

async function readTokensFromFile(filePathArg: string): Promise<string[]> {
  const filePath = path.resolve(filePathArg);
  if (!(await pathExists(filePath))) {
    fail(`Token file not found: ${filePath}`);
  }
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function collectTokensFromArgs(
  args: Record<string, unknown>,
  usage: string,
  required = false
): Promise<string[]> {
  const tokens = [...toStringList(args.token)];
  const tokenFile = getSingleString(args, "token-file");
  if (tokenFile) {
    tokens.push(...(await readTokensFromFile(tokenFile)));
  }
  const deduped = Array.from(new Set(tokens));
  if (required && deduped.length === 0) {
    fail(`No tokens provided.\n\n${usage}`);
  }
  return deduped;
}

function buildAuthorizationForTokens(tokens: string[]): Record<string, string> {
  if (tokens.length === 0) return {};
  return { Authorization: `Bearer ${tokens.join(",")}` };
}

function formatUnixMs(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  return new Date(value).toISOString();
}

function printTokenEntriesTable(items: unknown[]): void {
  if (items.length === 0) {
    console.log("(empty)");
    return;
  }
  console.log("token\tregion\tenabled\tlive\tlastCredit\tlastCheckedAt\tfailures");
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const entry = item as JsonRecord;
    const token = typeof entry.token === "string" ? entry.token : "-";
    const region = typeof entry.region === "string" ? entry.region : "-";
    const enabled = typeof entry.enabled === "boolean" ? String(entry.enabled) : "-";
    const live = typeof entry.live === "boolean" ? String(entry.live) : "-";
    const lastCredit = typeof entry.lastCredit === "number" ? String(entry.lastCredit) : "-";
    const lastCheckedAt = formatUnixMs(entry.lastCheckedAt);
    const failures =
      typeof entry.consecutiveFailures === "number" ? String(entry.consecutiveFailures) : "-";
    console.log(`${token}\t${region}\t${enabled}\t${live}\t${lastCredit}\t${lastCheckedAt}\t${failures}`);
  }
}

async function handleTokenCheck(argv: string[]): Promise<void> {
  const args = minimist(argv, {
    string: ["token", "token-file", "base-url", "region"],
    boolean: ["help"],
  });
  const usage = usageTokenSubcommand("check");
  if (args.help) {
    console.log(usage);
    return;
  }

  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const region = getSingleString(args, "region");
  const tokens = await collectTokensFromArgs(args, usage, true);
  console.log(`Checking ${tokens.length} token(s) against ${baseUrl}/token/check`);

  let invalid = 0;
  let requestErrors = 0;
  for (const token of tokens) {
    try {
      const { payload } = await requestJson(`${baseUrl}/token/check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(region ? { "X-Region": region } : {}),
        },
        body: JSON.stringify({ token, ...(region ? { region } : {}) }),
      });
      const normalized = unwrapBody(payload);
      const live =
        normalized && typeof normalized === "object" ? (normalized as JsonRecord).live : undefined;
      if (live === true) console.log(`[OK]   ${maskToken(token)} live=true`);
      else {
        invalid += 1;
        console.log(`[FAIL] ${maskToken(token)} live=false`);
      }
    } catch (error) {
      requestErrors += 1;
      console.log(`[ERROR] ${maskToken(token)} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`Summary: total=${tokens.length} invalid=${invalid} request_errors=${requestErrors}`);
  if (requestErrors > 0) process.exit(3);
  if (invalid > 0) process.exit(2);
}

async function handleTokenList(argv: string[]): Promise<void> {
  const args = minimist(argv, {
    string: ["base-url"],
    boolean: ["help", "json"],
  });
  const usage = usageTokenSubcommand("list");
  if (args.help) {
    console.log(usage);
    return;
  }
  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const { payload } = await requestJson(`${baseUrl}/token/pool`, { method: "GET" });
  const normalized = unwrapBody(payload);
  if (args.json) {
    console.log(JSON.stringify(normalized, null, 2));
    return;
  }
  const body = normalized && typeof normalized === "object" ? (normalized as JsonRecord) : {};
  const summary = body.summary;
  if (summary && typeof summary === "object") {
    console.log("Summary:");
    console.log(JSON.stringify(summary, null, 2));
  }
  const items = Array.isArray(body.items) ? body.items : [];
  console.log("Entries:");
  printTokenEntriesTable(items);
}

async function handleTokenPointsOrReceive(
  argv: string[],
  action: "points" | "receive"
): Promise<void> {
  const args = minimist(argv, {
    string: ["token", "token-file", "base-url", "region"],
    boolean: ["help"],
  });
  const usage = usageTokenSubcommand(action);
  if (args.help) {
    console.log(usage);
    return;
  }
  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const region = getSingleString(args, "region");
  const tokens = await collectTokensFromArgs(args, usage, false);
  const { payload } = await requestJson(`${baseUrl}/token/${action}`, {
    method: "POST",
    headers: {
      ...buildAuthorizationForTokens(tokens),
      ...(region ? { "X-Region": region } : {}),
    },
  });
  console.log(JSON.stringify(unwrapBody(payload), null, 2));
}

async function handleTokenAddOrRemove(argv: string[], action: "add" | "remove"): Promise<void> {
  const args = minimist(argv, {
    string: ["token", "token-file", "base-url", "region"],
    boolean: ["help"],
  });
  const usage = usageTokenSubcommand(action);
  if (args.help) {
    console.log(usage);
    return;
  }
  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const region = getSingleString(args, "region");
  const tokens = await collectTokensFromArgs(args, usage, true);
  const { payload } = await requestJson(`${baseUrl}/token/pool/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens, ...(region ? { region } : {}) }),
  });
  console.log(JSON.stringify(unwrapBody(payload), null, 2));
}

async function handleTokenEnableOrDisable(argv: string[], action: "enable" | "disable"): Promise<void> {
  const args = minimist(argv, {
    string: ["token", "base-url"],
    boolean: ["help"],
  });
  const usage = usageTokenSubcommand(action);
  if (args.help) {
    console.log(usage);
    return;
  }
  const token = getSingleString(args, "token");
  if (!token) {
    failWithUsage("Missing required --token.", usage);
  }
  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const { payload } = await requestJson(`${baseUrl}/token/pool/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  console.log(JSON.stringify(unwrapBody(payload), null, 2));
}

async function handleTokenPool(argv: string[]): Promise<void> {
  const args = minimist(argv, {
    string: ["base-url"],
    boolean: ["help", "json"],
  });
  const usage = usageTokenSubcommand("pool");
  if (args.help) {
    console.log(usage);
    return;
  }
  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const { payload } = await requestJson(`${baseUrl}/token/pool`, { method: "GET" });
  const normalized = unwrapBody(payload);
  if (args.json) {
    console.log(JSON.stringify(normalized, null, 2));
    return;
  }
  const body = normalized && typeof normalized === "object" ? (normalized as JsonRecord) : {};
  console.log("Summary:");
  console.log(JSON.stringify(body.summary ?? {}, null, 2));
  console.log("Entries:");
  printTokenEntriesTable(Array.isArray(body.items) ? body.items : []);
}

async function handleTokenPoolCheckOrReload(
  argv: string[],
  action: "pool-check" | "pool-reload"
): Promise<void> {
  const args = minimist(argv, {
    string: ["base-url"],
    boolean: ["help"],
  });
  const usage = usageTokenSubcommand(action);
  if (args.help) {
    console.log(usage);
    return;
  }
  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const endpoint = action === "pool-check" ? "/token/pool/check" : "/token/pool/reload";
  const { payload } = await requestJson(`${baseUrl}${endpoint}`, { method: "POST" });
  console.log(JSON.stringify(unwrapBody(payload), null, 2));
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
      "token",
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

  const token = getSingleString(args, "token");
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
      "Content-Type": "application/json",
      ...buildAuthHeaders(token),
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
      "token",
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

  const token = getSingleString(args, "token");
  const prompt = ensurePrompt(getSingleString(args, "prompt"), usageImageEdit());
  const sources = toStringList(args.image);
  if (sources.length === 0) {
    failWithUsage("Missing required --image.", usageImageEdit());
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
        "Content-Type": "application/json",
        ...buildAuthHeaders(token),
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
      headers: buildAuthHeaders(token),
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

type VideoCliMode = "text_to_video" | "image_to_video" | "first_last_frames" | "omni_reference";

const VIDEO_SUPPORTED_MODES: VideoCliMode[] = [
  "text_to_video",
  "image_to_video",
  "first_last_frames",
  "omni_reference",
];
const VIDEO_OMNI_SUPPORTED_MODELS = new Set(["jimeng-video-seedance-2.0", "jimeng-video-seedance-2.0-fast"]);
const VIDEO_OMNI_IMAGE_SLOT_KEYS = Array.from({ length: 9 }, (_, i) => `image-file-${i + 1}`);
const VIDEO_OMNI_VIDEO_SLOT_KEYS = Array.from({ length: 3 }, (_, i) => `video-file-${i + 1}`);

type VideoInputPlan = {
  repeatedImageInputs: string[];
  repeatedVideoInputs: string[];
  explicitImageSlots: Array<{ slot: number; input: string }>;
  explicitVideoSlots: Array<{ slot: number; input: string }>;
  totalImageInputs: number;
  totalVideoInputs: number;
};

function parseVideoCliMode(args: Record<string, unknown>, usage: string): VideoCliMode {
  const cliModeRaw = getSingleString(args, "mode") || "text_to_video";
  if (!VIDEO_SUPPORTED_MODES.includes(cliModeRaw as VideoCliMode)) {
    failWithUsage(
      `Invalid --mode: ${cliModeRaw}. Use text_to_video, image_to_video, first_last_frames, or omni_reference.`,
      usage
    );
  }
  return cliModeRaw as VideoCliMode;
}

function collectVideoInputPlan(args: Record<string, unknown>, usage: string): VideoInputPlan {
  const repeatedImageInputs = toStringList(args["image-file"]);
  const repeatedVideoInputs = toStringList(args["video-file"]);
  const explicitImageSlots = VIDEO_OMNI_IMAGE_SLOT_KEYS
    .map((key, i) => ({ slot: i + 1, input: getSingleString(args, key) }))
    .filter((item): item is { slot: number; input: string } => Boolean(item.input));
  const explicitVideoSlots = VIDEO_OMNI_VIDEO_SLOT_KEYS
    .map((key, i) => ({ slot: i + 1, input: getSingleString(args, key) }))
    .filter((item): item is { slot: number; input: string } => Boolean(item.input));

  if (repeatedImageInputs.length > 0 && explicitImageSlots.length > 0) {
    failWithUsage(
      "Do not mix repeated --image-file with explicit --image-file-N in one command.",
      usage
    );
  }
  if (repeatedVideoInputs.length > 0 && explicitVideoSlots.length > 0) {
    failWithUsage(
      "Do not mix repeated --video-file with explicit --video-file-N in one command.",
      usage
    );
  }

  return {
    repeatedImageInputs,
    repeatedVideoInputs,
    explicitImageSlots,
    explicitVideoSlots,
    totalImageInputs: repeatedImageInputs.length + explicitImageSlots.length,
    totalVideoInputs: repeatedVideoInputs.length + explicitVideoSlots.length,
  };
}

function validateVideoModeAndModel(cliMode: VideoCliMode, model: string, plan: VideoInputPlan, usage: string): void {
  if (cliMode === "omni_reference" && !VIDEO_OMNI_SUPPORTED_MODELS.has(model)) {
    failWithUsage(
      `omni_reference mode requires --model jimeng-video-seedance-2.0 or jimeng-video-seedance-2.0-fast (current: ${model}).`,
      usage
    );
  }

  if (cliMode === "text_to_video") {
    if (plan.totalImageInputs + plan.totalVideoInputs > 0) {
      failWithUsage("text_to_video mode does not accept --image-file or --video-file inputs.", usage);
    }
    return;
  }
  if (cliMode === "image_to_video") {
    if (plan.totalVideoInputs > 0) {
      failWithUsage("image_to_video mode does not accept --video-file.", usage);
    }
    if (plan.totalImageInputs !== 1) {
      failWithUsage("image_to_video mode requires exactly one --image-file input.", usage);
    }
    return;
  }
  if (cliMode === "first_last_frames") {
    if (plan.totalVideoInputs > 0) {
      failWithUsage("first_last_frames mode does not accept --video-file.", usage);
    }
    if (plan.totalImageInputs === 0) {
      failWithUsage("first_last_frames mode requires at least one --image-file input.", usage);
    }
    if (plan.totalImageInputs > 2) {
      failWithUsage("first_last_frames mode supports at most 2 image inputs.", usage);
    }
    return;
  }

  if (plan.totalImageInputs + plan.totalVideoInputs === 0) {
    failWithUsage("omni_reference mode requires at least one --image-file or --video-file input.", usage);
  }
  if (plan.totalImageInputs > 9) {
    failWithUsage("omni_reference supports at most 9 image inputs.", usage);
  }
  if (plan.totalVideoInputs > 3) {
    failWithUsage("omni_reference supports at most 3 video inputs.", usage);
  }
}

async function appendVideoInput(
  form: FormData,
  fieldName: string,
  input: string,
  mediaType: "image" | "video"
): Promise<void> {
  if (isHttpUrl(input)) {
    form.append(fieldName, input);
    return;
  }
  const filePath = path.resolve(input);
  if (!(await pathExists(filePath))) {
    fail(`Input file not found for ${fieldName}: ${filePath}`);
  }
  const buffer = await readFile(filePath);
  const mime = mediaType === "image" ? detectImageMime(filePath) : detectVideoUploadMime(filePath);
  form.append(fieldName, new Blob([buffer], { type: mime }), path.basename(filePath));
}

async function appendVideoInputs(form: FormData, plan: VideoInputPlan): Promise<void> {
  for (let i = 0; i < plan.repeatedImageInputs.length; i += 1) {
    await appendVideoInput(form, `image_file_${i + 1}`, plan.repeatedImageInputs[i], "image");
  }
  for (let i = 0; i < plan.repeatedVideoInputs.length; i += 1) {
    await appendVideoInput(form, `video_file_${i + 1}`, plan.repeatedVideoInputs[i], "video");
  }
  for (const slot of plan.explicitImageSlots) {
    await appendVideoInput(form, `image_file_${slot.slot}`, slot.input, "image");
  }
  for (const slot of plan.explicitVideoSlots) {
    await appendVideoInput(form, `video_file_${slot.slot}`, slot.input, "video");
  }
}

async function handleVideoGenerate(argv: string[]): Promise<void> {
  const usage = usageVideoGenerate();
  const args = minimist(argv, {
    string: [
      "token",
      "prompt",
      "mode",
      "image-file",
      "video-file",
      ...VIDEO_OMNI_IMAGE_SLOT_KEYS,
      ...VIDEO_OMNI_VIDEO_SLOT_KEYS,
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
    console.log(usage);
    return;
  }

  const token = getSingleString(args, "token");
  const prompt = ensurePrompt(getSingleString(args, "prompt"), usage);
  const cliMode = parseVideoCliMode(args, usage);
  const inputPlan = collectVideoInputPlan(args, usage);

  const baseUrl = sanitizeBaseUrl(getSingleString(args, "base-url"));
  const outputDir = getSingleString(args, "output-dir") || "./pic/cli-video-generate";
  const model = getSingleString(args, "model")
    || (cliMode === "omni_reference" ? "jimeng-video-seedance-2.0-fast" : "jimeng-video-3.0");
  validateVideoModeAndModel(cliMode, model, inputPlan, usage);
  const functionMode = cliMode === "omni_reference" ? "omni_reference" : "first_last_frames";
  const ratio = getSingleString(args, "ratio") || "1:1";
  const resolution = getSingleString(args, "resolution") || "720p";
  const duration = getSingleString(args, "duration") || "5";

  const form = new FormData();
  form.append("prompt", prompt);
  form.append("model", model);
  form.append("functionMode", functionMode);
  form.append("ratio", ratio);
  form.append("resolution", resolution);
  form.append("duration", duration);
  await appendVideoInputs(form, inputPlan);

  const endpoint = `${baseUrl}/v1/videos/generations`;
  console.log(`Calling: ${endpoint}`);
  const { payload } = await requestJson(endpoint, {
    method: "POST",
    headers: buildAuthHeaders(token),
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

function isHelpKeyword(value: string | undefined): boolean {
  return value === "--help" || value === "-h" || value === "help";
}

type TokenSubcommandDef = {
  name: TokenSubcommandName;
  description: string;
  usageLine: string;
  options: string[];
  sections?: UsageSection[];
  handler: CliHandler;
};

type TokenSubcommandName =
  | "list"
  | "check"
  | "points"
  | "receive"
  | "add"
  | "remove"
  | "enable"
  | "disable"
  | "pool"
  | "pool-check"
  | "pool-reload";

const TOKEN_SUBCOMMANDS: TokenSubcommandDef[] = [
  {
    name: "list",
    description: "List token pool entries",
    usageLine: "  jimeng token list [options]",
    options: ["  --json                   Output raw JSON", BASE_URL_OPTION, HELP_OPTION],
    handler: handleTokenList,
  },
  {
    name: "check",
    description: "Validate tokens via /token/check",
    usageLine: "  jimeng token check --token <token> [--token <token> ...] [options]",
    options: [
      "  --token <token>          Token, can be repeated",
      "  --token-file <path>      Read tokens from file (one per line, # for comments)",
      "  --region <region>        Required for non-pool token (cn/us/hk/jp/sg)",
      BASE_URL_OPTION,
      HELP_OPTION,
    ],
    handler: handleTokenCheck,
  },
  {
    name: "points",
    description: "Query token points (fallback to server token-pool)",
    usageLine: "  jimeng token points [options]",
    options: [
      "  --token <token>          Token, can be repeated",
      "  --token-file <path>      Read tokens from file (one per line, # for comments)",
      "  --region <region>        Optional X-Region header (cn/us/hk/jp/sg)",
      BASE_URL_OPTION,
      HELP_OPTION,
    ],
    handler: async (argv) => handleTokenPointsOrReceive(argv, "points"),
  },
  {
    name: "receive",
    description: "Receive token credits (fallback to server token-pool)",
    usageLine: "  jimeng token receive [options]",
    options: [
      "  --token <token>          Token, can be repeated",
      "  --token-file <path>      Read tokens from file (one per line, # for comments)",
      "  --region <region>        Optional X-Region header (cn/us/hk/jp/sg)",
      BASE_URL_OPTION,
      HELP_OPTION,
    ],
    handler: async (argv) => handleTokenPointsOrReceive(argv, "receive"),
  },
  {
    name: "add",
    description: "Add token(s) into token-pool",
    usageLine: "  jimeng token add --token <token> [--token <token> ...] [options]",
    options: [
      "  --token <token>          Token, can be repeated",
      "  --token-file <path>      Read tokens from file (one per line, # for comments)",
      "  --region <region>        Required for add (cn/us/hk/jp/sg)",
      BASE_URL_OPTION,
      HELP_OPTION,
    ],
    handler: async (argv) => handleTokenAddOrRemove(argv, "add"),
  },
  {
    name: "remove",
    description: "Remove token(s) from token-pool",
    usageLine: "  jimeng token remove --token <token> [--token <token> ...] [options]",
    options: [
      "  --token <token>          Token, can be repeated",
      "  --token-file <path>      Read tokens from file (one per line, # for comments)",
      BASE_URL_OPTION,
      HELP_OPTION,
    ],
    handler: async (argv) => handleTokenAddOrRemove(argv, "remove"),
  },
  {
    name: "enable",
    description: "Enable one token in token-pool",
    usageLine: "  jimeng token enable --token <token> [options]",
    options: ["  --token <token>          Required, a single token", BASE_URL_OPTION, HELP_OPTION],
    handler: async (argv) => handleTokenEnableOrDisable(argv, "enable"),
  },
  {
    name: "disable",
    description: "Disable one token in token-pool",
    usageLine: "  jimeng token disable --token <token> [options]",
    options: ["  --token <token>          Required, a single token", BASE_URL_OPTION, HELP_OPTION],
    handler: async (argv) => handleTokenEnableOrDisable(argv, "disable"),
  },
  {
    name: "pool",
    description: "Show token-pool summary and entries",
    usageLine: "  jimeng token pool [options]",
    options: ["  --json                   Output raw JSON", BASE_URL_OPTION, HELP_OPTION],
    handler: handleTokenPool,
  },
  {
    name: "pool-check",
    description: "Trigger token-pool health check",
    usageLine: "  jimeng token pool-check [options]",
    options: [BASE_URL_OPTION, HELP_OPTION],
    handler: async (argv) => handleTokenPoolCheckOrReload(argv, "pool-check"),
  },
  {
    name: "pool-reload",
    description: "Reload token-pool from disk",
    usageLine: "  jimeng token pool-reload [options]",
    options: [BASE_URL_OPTION, HELP_OPTION],
    handler: async (argv) => handleTokenPoolCheckOrReload(argv, "pool-reload"),
  },
];

const TOKEN_SUBCOMMANDS_BY_NAME: Record<TokenSubcommandName, TokenSubcommandDef> = Object.fromEntries(
  TOKEN_SUBCOMMANDS.map((subcommand) => [subcommand.name, subcommand])
) as Record<TokenSubcommandName, TokenSubcommandDef>;

function buildHandlersMap(
  subcommands: Array<{ name: string; handler: CliHandler }>
): Record<string, CliHandler> {
  return Object.fromEntries(subcommands.map((item) => [item.name, item.handler]));
}

type CommandSubcommandDef = {
  name: string;
  description: string;
  handler: CliHandler;
};

type CommandSpec = {
  name: string;
  description: string;
  handler?: CliHandler;
  subcommands?: CommandSubcommandDef[];
  usage?: () => string;
  showAsGrouped?: boolean;
};

const COMMAND_SPECS: CommandSpec[] = [
  {
    name: "serve",
    description: "Start jimeng-api service",
    handler: async () => {
      const { startService } = await import("../lib/start-service.ts");
      await startService();
    },
  },
  {
    name: "models",
    description: "Model commands",
    subcommands: [{ name: "list", description: "List available models", handler: handleModelsList }],
    usage: usageRoot,
  },
  {
    name: "image",
    description: "Image commands",
    subcommands: [
      { name: "generate", description: "Generate image from text", handler: handleImageGenerate },
      { name: "edit", description: "Edit image(s) with prompt", handler: handleImageEdit },
    ],
    usage: usageRoot,
  },
  {
    name: "video",
    description: "Video commands",
    subcommands: [
      {
        name: "generate",
        description: "Generate video from multimodal references",
        handler: handleVideoGenerate,
      },
    ],
    usage: usageRoot,
  },
  {
    name: "token",
    description: "Token management commands",
    subcommands: TOKEN_SUBCOMMANDS.map((subcommand) => ({
      name: subcommand.name,
      description: subcommand.description,
      handler: subcommand.handler,
    })),
    usage: usageTokenRoot,
    showAsGrouped: true,
  },
];

const COMMAND_SPECS_BY_NAME: Record<string, CommandSpec> = Object.fromEntries(
  COMMAND_SPECS.map((spec) => [spec.name, spec])
);

const ROOT_COMMAND_ENTRIES: Array<{ path: string; description: string }> = COMMAND_SPECS.flatMap((spec) => {
  if (spec.handler) {
    return [{ path: spec.name, description: spec.description }];
  }
  if (!spec.subcommands || spec.subcommands.length === 0) {
    return [{ path: spec.name, description: spec.description }];
  }
  if (spec.showAsGrouped) {
    return [{ path: `${spec.name} <subcommand>`, description: spec.description }];
  }
  return spec.subcommands.map((subcommand) => ({
    path: `${spec.name} ${subcommand.name}`,
    description: subcommand.description,
  }));
});

const ROOT_HELP_HINT_LINES: string[] = [
  "Run `jimeng <command> --help` for command details.",
  ...COMMAND_SPECS
    .filter((spec) => spec.showAsGrouped)
    .map((spec) => `Run \`jimeng ${spec.name} --help\` for ${spec.name} subcommands.`),
];

async function dispatchSubcommand(
  subcommand: string | undefined,
  argv: string[],
  handlers: Record<string, CliHandler>,
  usage: string,
  unknownLabel: string
): Promise<boolean> {
  if (!subcommand || isHelpKeyword(subcommand)) {
    console.log(usage);
    return true;
  }
  const handler = handlers[subcommand];
  if (!handler) {
    failWithUsage(`Unknown ${unknownLabel}: ${subcommand}`, usage);
  }
  await handler(argv);
  return true;
}

async function run(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (!command || isHelpKeyword(command)) {
    console.log(usageRoot());
    return;
  }
  const spec = COMMAND_SPECS_BY_NAME[command];
  if (!spec) {
    failWithUsage(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`, usageRoot());
  }

  if (spec.handler) {
    await spec.handler(rest);
    return;
  }

  if (spec.subcommands) {
    const handlers = buildHandlersMap(spec.subcommands);
    if (
      await dispatchSubcommand(
        subcommand,
        process.argv.slice(3),
        handlers,
        spec.usage ? spec.usage() : usageRoot(),
        `${command} subcommand`
      )
    ) {
      return;
    }
  }

  failWithUsage(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`, usageRoot());
}

run().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

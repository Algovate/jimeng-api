#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";

const PREFIX_TO_REGION = {
  "us-": "us",
  "hk-": "hk",
  "jp-": "jp",
  "sg-": "sg",
};

function resolveRegionFromToken(token) {
  const normalized = String(token || "").trim().toLowerCase();
  for (const [prefix, region] of Object.entries(PREFIX_TO_REGION)) {
    if (normalized.startsWith(prefix)) {
      return { region, strippedToken: String(token).trim().slice(prefix.length) };
    }
  }
  return null;
}

function parseArgs(argv) {
  const args = {
    file: "configs/token-pool.json",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (cur === "--dry-run") {
      args.dryRun = true;
    } else if (cur === "--file") {
      args.file = argv[i + 1] || args.file;
      i++;
    }
  }
  return args;
}

async function main() {
  const { file, dryRun } = parseArgs(process.argv.slice(2));
  const targetPath = path.resolve(process.cwd(), file);
  const raw = await fs.readFile(targetPath, "utf-8");
  const json = JSON.parse(raw);

  if (!Array.isArray(json.tokens)) {
    throw new Error(`invalid token-pool format: missing tokens array in ${targetPath}`);
  }

  let changed = 0;
  let addedRegion = 0;
  let strippedPrefix = 0;

  const nextTokens = json.tokens.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const token = String(entry.token || "").trim();
    if (!token) return entry;

    const next = { ...entry };
    const parsed = resolveRegionFromToken(token);

    if (parsed) {
      if (next.token !== parsed.strippedToken) {
        next.token = parsed.strippedToken;
        strippedPrefix++;
        changed++;
      }
      if (!next.region) {
        next.region = parsed.region;
        addedRegion++;
        changed++;
      }
      return next;
    }

    if (!next.region) {
      next.region = "cn";
      addedRegion++;
      changed++;
    }
    return next;
  });

  const nextJson = {
    ...json,
    updatedAt: Date.now(),
    tokens: nextTokens,
  };

  if (changed === 0) {
    console.log(`[migrate-token-pool] no changes needed: ${targetPath}`);
    return;
  }

  if (dryRun) {
    console.log(`[migrate-token-pool] dry-run: would update ${targetPath}`);
    console.log(`[migrate-token-pool] changed=${changed}, strippedPrefix=${strippedPrefix}, addedRegion=${addedRegion}`);
    return;
  }

  const backupPath = `${targetPath}.bak.${Date.now()}`;
  await fs.copyFile(targetPath, backupPath);
  await fs.writeFile(targetPath, `${JSON.stringify(nextJson, null, 2)}\n`, "utf-8");

  console.log(`[migrate-token-pool] updated: ${targetPath}`);
  console.log(`[migrate-token-pool] backup: ${backupPath}`);
  console.log(`[migrate-token-pool] changed=${changed}, strippedPrefix=${strippedPrefix}, addedRegion=${addedRegion}`);
}

main().catch((err) => {
  console.error(`[migrate-token-pool] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});


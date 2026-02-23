import path from "path";
import fs from "fs-extra";
import _ from "lodash";

import logger from "@/lib/logger.ts";
import { getCredit, getTokenLiveStatus } from "@/api/controllers/core.ts";

export interface SessionPoolEntry {
  token: string;
  enabled: boolean;
  live?: boolean;
  lastCheckedAt?: number;
  lastError?: string;
  lastCredit?: number;
  consecutiveFailures: number;
}

interface SessionPoolFile {
  updatedAt: number;
  tokens: SessionPoolEntry[];
}

type PickStrategy = "random" | "round_robin";
export type AuthorizationTokenError = "invalid_authorization_format" | "empty_authorization_tokens";

export interface AuthorizationTokenPickResult {
  token: string | null;
  error: AuthorizationTokenError | null;
}

class SessionPool {
  private readonly enabled: boolean;
  private readonly filePath: string;
  private readonly healthCheckIntervalMs: number;
  private readonly fetchCreditOnCheck: boolean;
  private readonly autoDisableEnabled: boolean;
  private readonly autoDisableFailures: number;
  private readonly pickStrategy: PickStrategy;

  private readonly entryMap = new Map<string, SessionPoolEntry>();
  private initialized = false;
  private healthChecking = false;
  private lastHealthCheckAt = 0;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private roundRobinCursor = 0;

  constructor() {
    this.enabled = process.env.SESSION_POOL_ENABLED !== "false";
    this.filePath = path.resolve(
      process.env.SESSION_POOL_FILE || "configs/session-pool.json"
    );
    this.healthCheckIntervalMs = Number(
      process.env.SESSION_POOL_HEALTHCHECK_INTERVAL_MS || 10 * 60 * 1000
    );
    this.fetchCreditOnCheck = process.env.SESSION_POOL_FETCH_CREDIT === "true";
    this.autoDisableEnabled = process.env.SESSION_POOL_AUTO_DISABLE !== "false";
    this.autoDisableFailures = Math.max(
      1,
      Number(process.env.SESSION_POOL_AUTO_DISABLE_FAILURES || 2)
    );
    this.pickStrategy = process.env.SESSION_POOL_STRATEGY === "round_robin"
      ? "round_robin"
      : "random";
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.enabled) {
      logger.info("Session pool disabled by SESSION_POOL_ENABLED=false");
      return;
    }
    await this.loadFromDisk();
    this.startHealthCheckLoop();
    logger.info(
      `Session pool initialized: total=${this.entryMap.size}, file=${this.filePath}`
    );
  }

  getSummary() {
    const entries = this.getEntries(false);
    const enabledCount = entries.filter((item) => item.enabled).length;
    const liveCount = entries.filter((item) => item.enabled && item.live === true).length;
    return {
      enabled: this.enabled,
      filePath: this.filePath,
      pickStrategy: this.pickStrategy,
      healthCheckIntervalMs: this.healthCheckIntervalMs,
      fetchCreditOnCheck: this.fetchCreditOnCheck,
      autoDisableEnabled: this.autoDisableEnabled,
      autoDisableFailures: this.autoDisableFailures,
      total: entries.length,
      enabledCount,
      liveCount,
      lastHealthCheckAt: this.lastHealthCheckAt || null
    };
  }

  getEntries(maskToken = true): SessionPoolEntry[] {
    const items = Array.from(this.entryMap.values()).map((item) => ({ ...item }));
    if (!maskToken) return items;
    return items.map((item) => ({
      ...item,
      token: this.maskToken(item.token)
    }));
  }

  getAllTokens(options: { onlyEnabled?: boolean; preferLive?: boolean } = {}): string[] {
    const { onlyEnabled = true, preferLive = true } = options;
    const entries = this.getEntries(false).filter((item) => {
      if (onlyEnabled && !item.enabled) return false;
      if (preferLive && item.live === false) return false;
      return true;
    });
    return entries.map((item) => item.token);
  }

  pickTokenFromAuthorization(authorization?: string): string | null {
    return this.pickTokenFromAuthorizationDetailed(authorization).token;
  }

  pickTokenFromAuthorizationDetailed(authorization?: string): AuthorizationTokenPickResult {
    if (_.isString(authorization)) {
      if (authorization.trim().length === 0) return { token: this.pickToken(), error: null };
      if (!/^Bearer\s+/i.test(authorization)) {
        return { token: null, error: "invalid_authorization_format" };
      }
      const tokens = authorization
        .replace(/^Bearer\s+/i, "")
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean);
      if (tokens.length === 0) {
        return { token: null, error: "empty_authorization_tokens" };
      }
      return { token: _.sample(tokens) || null, error: null };
    }
    return { token: this.pickToken(), error: null };
  }

  pickToken(): string | null {
    if (!this.enabled) return null;
    const tokens = this.getAllTokens({ onlyEnabled: true, preferLive: true });
    if (tokens.length === 0) return null;
    if (this.pickStrategy === "round_robin") {
      const token = tokens[this.roundRobinCursor % tokens.length];
      this.roundRobinCursor++;
      return token;
    }
    return _.sample(tokens) || null;
  }

  async addTokens(rawTokens: string[]): Promise<{ added: number; total: number }> {
    if (!this.enabled) return { added: 0, total: 0 };
    const tokens = rawTokens.map((token) => token.trim()).filter(Boolean);
    let added = 0;
    for (const token of tokens) {
      if (this.entryMap.has(token)) continue;
      this.entryMap.set(token, {
        token,
        enabled: true,
        live: undefined,
        lastCheckedAt: undefined,
        lastError: undefined,
        lastCredit: undefined,
        consecutiveFailures: 0
      });
      added++;
    }
    if (added > 0) {
      await this.persistToDisk();
      logger.info(`Session pool add tokens: added=${added}, total=${this.entryMap.size}`);
    }
    return { added, total: this.entryMap.size };
  }

  async removeTokens(rawTokens: string[]): Promise<{ removed: number; total: number }> {
    if (!this.enabled) return { removed: 0, total: 0 };
    const tokens = rawTokens.map((token) => token.trim()).filter(Boolean);
    let removed = 0;
    for (const token of tokens) {
      if (this.entryMap.delete(token)) removed++;
    }
    if (removed > 0) {
      await this.persistToDisk();
      logger.info(`Session pool remove tokens: removed=${removed}, total=${this.entryMap.size}`);
    }
    return { removed, total: this.entryMap.size };
  }

  async setTokenEnabled(token: string, enabled: boolean): Promise<boolean> {
    if (!this.enabled) return false;
    const item = this.entryMap.get(token);
    if (!item) return false;
    item.enabled = enabled;
    if (!enabled) item.live = false;
    await this.persistToDisk();
    return true;
  }

  async reloadFromDisk(): Promise<void> {
    await this.loadFromDisk();
  }

  async runHealthCheck(): Promise<{
    checked: number;
    live: number;
    invalid: number;
    disabled: number;
  }> {
    if (!this.enabled) return { checked: 0, live: 0, invalid: 0, disabled: 0 };
    if (this.healthChecking) {
      return { checked: 0, live: 0, invalid: 0, disabled: 0 };
    }
    this.healthChecking = true;
    const entries = this.getEntries(false).filter((item) => item.enabled);
    let checked = 0;
    let live = 0;
    let invalid = 0;
    let disabled = 0;

    try {
      for (const item of entries) {
        checked++;
        const current = this.entryMap.get(item.token);
        if (!current || !current.enabled) continue;
        current.lastCheckedAt = Date.now();
        try {
          const isLive = await getTokenLiveStatus(current.token);
          current.live = isLive;
          current.lastError = undefined;
          if (isLive) {
            current.consecutiveFailures = 0;
            live++;
            if (this.fetchCreditOnCheck) {
              try {
                const credit = await getCredit(current.token);
                current.lastCredit = credit.totalCredit;
              } catch (err: any) {
                current.lastError = `credit_check_failed: ${err?.message || String(err)}`;
              }
            }
          } else {
            invalid++;
            current.consecutiveFailures++;
            current.lastError = "token_not_live";
          }
        } catch (err: any) {
          invalid++;
          current.live = false;
          current.consecutiveFailures++;
          current.lastError = err?.message || String(err);
        }

        if (
          this.autoDisableEnabled &&
          current.consecutiveFailures >= this.autoDisableFailures
        ) {
          current.enabled = false;
          current.live = false;
          disabled++;
        }
      }
      this.lastHealthCheckAt = Date.now();
      await this.persistToDisk();
      logger.info(
        `Session pool health check done: checked=${checked}, live=${live}, invalid=${invalid}, disabled=${disabled}`
      );
      return { checked, live, invalid, disabled };
    } finally {
      this.healthChecking = false;
    }
  }

  private startHealthCheckLoop() {
    if (!this.enabled || this.healthCheckIntervalMs <= 0) return;
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck().catch((err) => {
        logger.warn(`Session pool health check failed: ${err?.message || String(err)}`);
      });
    }, this.healthCheckIntervalMs);
    if (typeof this.healthCheckTimer.unref === "function") this.healthCheckTimer.unref();
  }

  private async loadFromDisk() {
    await fs.ensureDir(path.dirname(this.filePath));
    if (!await fs.pathExists(this.filePath)) {
      await this.persistToDisk();
      return;
    }
    let data: SessionPoolFile | null = null;
    try {
      data = await fs.readJson(this.filePath);
    } catch (err: any) {
      logger.warn(`Session pool file parse failed, fallback to empty: ${err?.message || String(err)}`);
      data = null;
    }
    const items = Array.isArray(data?.tokens) ? data!.tokens : [];
    const nextMap = new Map<string, SessionPoolEntry>();
    for (const raw of items) {
      const token = String(raw?.token || "").trim();
      if (!token) continue;
      nextMap.set(token, {
        token,
        enabled: raw.enabled !== false,
        live: _.isBoolean(raw.live) ? raw.live : undefined,
        lastCheckedAt: _.isFinite(Number(raw.lastCheckedAt)) ? Number(raw.lastCheckedAt) : undefined,
        lastError: _.isString(raw.lastError) ? raw.lastError : undefined,
        lastCredit: _.isFinite(Number(raw.lastCredit)) ? Number(raw.lastCredit) : undefined,
        consecutiveFailures: Math.max(0, Number(raw.consecutiveFailures) || 0)
      });
    }
    this.entryMap.clear();
    for (const [token, item] of nextMap.entries()) this.entryMap.set(token, item);
  }

  private async persistToDisk() {
    await fs.ensureDir(path.dirname(this.filePath));
    const payload: SessionPoolFile = {
      updatedAt: Date.now(),
      tokens: this.getEntries(false)
    };
    await fs.writeJson(this.filePath, payload, { spaces: 2 });
  }

  private maskToken(token: string) {
    if (token.length <= 10) return "***";
    return `${token.slice(0, 4)}...${token.slice(-4)}`;
  }
}

export default new SessionPool();

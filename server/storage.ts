import {
  type User,
  type InsertUser,
  type Strategy,
  type InsertStrategy,
  type UpdateStrategy,
  type Trade,
  type MarketTick,
  type InsertTick,
  type Webhook,
  type InsertWebhook,
  type UpdateWebhook,
  type WebhookDelivery,
  type Release,
  type PublicRelease,
  type License,
  type Download,
  type AuditLogEntry,
  type LedgerEntry,
  type DailyAudit,
  type AuditChecklistItem,
  type FailoverNode,
  type FallbackConfig,
  type FailoverEvent,
} from "@shared/schema";
import { randomUUID, createHash, scryptSync, timingSafeEqual } from "crypto";

export function hashPassword(password: string, salt?: string): string {
  const s = salt ?? randomUUID();
  const hash = scryptSync(password, s, 32).toString("hex");
  return `${s}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface TradeQuery {
  strategyId?: string;
  symbol?: string;
  mode?: string;
  limit?: number;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Strategies
  getStrategies(): Promise<Strategy[]>;
  getStrategy(id: string): Promise<Strategy | undefined>;
  createStrategy(strategy: InsertStrategy): Promise<Strategy>;
  updateStrategy(
    id: string,
    update: UpdateStrategy,
  ): Promise<Strategy | undefined>;
  deleteStrategy(id: string): Promise<boolean>;

  // Trades
  getTrades(query: TradeQuery): Promise<Trade[]>;
  createTrade(
    trade: Omit<Trade, "id" | "executedAt"> & { executedAt?: Date },
  ): Promise<Trade>;

  // Market ticks
  getTicks(symbol?: string, limit?: number): Promise<MarketTick[]>;
  createTick(tick: InsertTick & { ts?: Date }): Promise<MarketTick>;

  // Webhooks
  getWebhooks(): Promise<Webhook[]>;
  getWebhook(id: string): Promise<Webhook | undefined>;
  createWebhook(webhook: InsertWebhook & { secret: string }): Promise<Webhook>;
  updateWebhook(
    id: string,
    update: UpdateWebhook,
  ): Promise<Webhook | undefined>;
  deleteWebhook(id: string): Promise<boolean>;

  // Webhook deliveries
  getWebhookDeliveries(webhookId?: string): Promise<WebhookDelivery[]>;
  createWebhookDelivery(
    delivery: Omit<WebhookDelivery, "id" | "deliveredAt"> & {
      deliveredAt?: Date;
    },
  ): Promise<WebhookDelivery>;

  // Users / auth
  listUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;

  // Releases (DaaS distribution)
  getReleases(publishedOnly?: boolean): Promise<Release[]>;
  getRelease(id: string): Promise<Release | undefined>;
  createRelease(
    release: Omit<Release, "id" | "createdAt" | "sha256" | "sizeBytes">,
  ): Promise<Release>;
  updateRelease(
    id: string,
    update: Partial<Pick<Release, "version" | "channel" | "notes" | "published">>,
  ): Promise<Release | undefined>;
  deleteRelease(id: string): Promise<boolean>;

  // Licenses
  getLicenses(): Promise<License[]>;
  getLicense(id: string): Promise<License | undefined>;
  getLicenseByKey(key: string): Promise<License | undefined>;
  createLicense(
    license: Pick<License, "userId" | "label" | "maxDownloads" | "expiresAt">,
  ): Promise<License>;
  updateLicense(
    id: string,
    update: Partial<Pick<License, "label" | "status" | "maxDownloads">>,
  ): Promise<License | undefined>;
  incrementLicenseDownloads(id: string): Promise<void>;

  // Downloads
  getDownloads(): Promise<Download[]>;
  createDownload(
    download: Omit<Download, "id" | "downloadedAt">,
  ): Promise<Download>;

  // Audit log / ledger
  appendAuditLog(
    entry: Omit<AuditLogEntry, "id" | "ts"> & { ts?: Date },
  ): Promise<AuditLogEntry>;
  getAuditLog(limit?: number): Promise<AuditLogEntry[]>;
  appendLedgerEntry(
    entry: Omit<LedgerEntry, "id" | "ts"> & { ts?: Date },
  ): Promise<LedgerEntry>;
  getLedgerEntries(limit?: number): Promise<LedgerEntry[]>;

  // Daily audits
  getDailyAudits(): Promise<DailyAudit[]>;
  getDailyAudit(id: string): Promise<DailyAudit | undefined>;
  getDailyAuditByDate(date: string): Promise<DailyAudit | undefined>;
  createDailyAudit(
    audit: Omit<DailyAudit, "id" | "createdAt" | "reviewedBy" | "reviewedAt" | "reviewNote">,
  ): Promise<DailyAudit>;
  reviewDailyAudit(
    id: string,
    decision: "approved" | "rejected",
    reviewer: string,
    note: string,
    checklist?: AuditChecklistItem[],
  ): Promise<DailyAudit | undefined>;

  // Failover / resilience
  getFailoverNodes(): Promise<FailoverNode[]>;
  getFailoverNode(id: string): Promise<FailoverNode | undefined>;
  createFailoverNode(
    node: Pick<FailoverNode, "name" | "baseUrl" | "role" | "authToken">,
  ): Promise<FailoverNode>;
  updateFailoverNode(
    id: string,
    update: Partial<
      Pick<
        FailoverNode,
        | "name"
        | "baseUrl"
        | "role"
        | "enabled"
        | "authToken"
        | "status"
        | "lastHeartbeatAt"
        | "lastHeartbeatLatencyMs"
        | "lastSnapshotAt"
        | "consecutiveFailures"
      >
    >,
  ): Promise<FailoverNode | undefined>;
  deleteFailoverNode(id: string): Promise<boolean>;

  getFallbackConfig(): Promise<FallbackConfig>;
  updateFallbackConfig(
    update: Partial<FallbackConfig>,
    updatedBy: string,
  ): Promise<FallbackConfig>;

  appendFailoverEvent(
    event: Omit<FailoverEvent, "id" | "ts"> & { ts?: Date },
  ): Promise<FailoverEvent>;
  getFailoverEvents(limit?: number): Promise<FailoverEvent[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private strategies: Map<string, Strategy>;
  private trades: Trade[];
  private ticks: MarketTick[];
  private webhooks: Map<string, Webhook>;
  private deliveries: WebhookDelivery[];
  private releases: Map<string, Release>;
  private licenses: Map<string, License>;
  private downloads: Download[];
  private auditLog: AuditLogEntry[];
  private ledger: LedgerEntry[];
  private dailyAudits: Map<string, DailyAudit>;
  private failoverNodes: Map<string, FailoverNode>;
  private fallbackConfig: FallbackConfig;
  private failoverEvents: FailoverEvent[];

  constructor() {
    this.users = new Map();
    this.strategies = new Map();
    this.trades = [];
    this.ticks = [];
    this.webhooks = new Map();
    this.deliveries = [];
    this.releases = new Map();
    this.licenses = new Map();
    this.downloads = [];
    this.auditLog = [];
    this.ledger = [];
    this.dailyAudits = new Map();
    this.failoverNodes = new Map();
    this.failoverEvents = [];
    this.fallbackConfig = {
      id: randomUUID(),
      heartbeatIntervalMs: 15_000,
      heartbeatTimeoutMs: 5_000,
      maxConsecutiveFailures: 3,
      autoFailover: true,
      syncBatchSize: 500,
      maxFeedStalenessMs: 60_000,
      qualityDegradedVolatilityPct: 8,
      haltOnCriticalAnomaly: true,
      lockdownLevel: "none",
      updatedAt: new Date(),
      updatedBy: "system",
    };
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      ...insertUser,
      password: hashPassword(insertUser.password),
      role: "user",
      id,
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async listUsers(): Promise<User[]> {
    return Array.from(this.users.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const existing = this.users.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, role };
    this.users.set(id, updated);
    return updated;
  }

  // --- Strategies ------------------------------------------------------------

  async getStrategies(): Promise<Strategy[]> {
    return Array.from(this.strategies.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async getStrategy(id: string): Promise<Strategy | undefined> {
    return this.strategies.get(id);
  }

  async createStrategy(insert: InsertStrategy): Promise<Strategy> {
    const strategy: Strategy = {
      id: randomUUID(),
      name: insert.name,
      symbol: insert.symbol,
      algorithm: insert.algorithm,
      params: insert.params,
      riskLimits: insert.riskLimits,
      status: "stopped",
      createdAt: new Date(),
    };
    this.strategies.set(strategy.id, strategy);
    return strategy;
  }

  async updateStrategy(
    id: string,
    update: UpdateStrategy,
  ): Promise<Strategy | undefined> {
    const existing = this.strategies.get(id);
    if (!existing) return undefined;
    const merged: Strategy = {
      ...existing,
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.symbol !== undefined ? { symbol: update.symbol } : {}),
      ...(update.params !== undefined
        ? {
            params: {
              ...(existing.params as Record<string, number>),
              ...update.params,
            },
          }
        : {}),
      ...(update.riskLimits !== undefined
        ? {
            riskLimits: {
              ...(existing.riskLimits as Record<string, number>),
              ...update.riskLimits,
            },
          }
        : {}),
    };
    this.strategies.set(id, merged);
    return merged;
  }

  async deleteStrategy(id: string): Promise<boolean> {
    return this.strategies.delete(id);
  }

  /** Internal: mutate strategy status without touching other fields. */
  async setStrategyStatus(
    id: string,
    status: "running" | "stopped",
  ): Promise<Strategy | undefined> {
    const existing = this.strategies.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, status };
    this.strategies.set(id, updated);
    return updated;
  }

  // --- Trades ----------------------------------------------------------------

  async getTrades(query: TradeQuery): Promise<Trade[]> {
    let out = this.trades;
    if (query.strategyId)
      out = out.filter((t) => t.strategyId === query.strategyId);
    if (query.symbol) out = out.filter((t) => t.symbol === query.symbol);
    if (query.mode) out = out.filter((t) => t.mode === query.mode);
    out = [...out].sort(
      (a, b) => b.executedAt.getTime() - a.executedAt.getTime(),
    );
    return out.slice(0, query.limit ?? 500);
  }

  async createTrade(
    trade: Omit<Trade, "id" | "executedAt"> & { executedAt?: Date },
  ): Promise<Trade> {
    const record: Trade = {
      ...trade,
      id: randomUUID(),
      executedAt: trade.executedAt ?? new Date(),
    };
    this.trades.push(record);
    return record;
  }

  // --- Market ticks -----------------------------------------------------------

  async getTicks(symbol?: string, limit = 500): Promise<MarketTick[]> {
    let out = this.ticks;
    if (symbol) out = out.filter((t) => t.symbol === symbol);
    out = [...out].sort((a, b) => b.ts.getTime() - a.ts.getTime());
    return out.slice(0, limit);
  }

  async createTick(tick: InsertTick & { ts?: Date }): Promise<MarketTick> {
    const record: MarketTick = {
      id: randomUUID(),
      symbol: tick.symbol,
      price: tick.price,
      volume: tick.volume,
      ts: tick.ts ?? new Date(),
    };
    this.ticks.push(record);
    return record;
  }

  // --- Webhooks ---------------------------------------------------------------

  async getWebhooks(): Promise<Webhook[]> {
    return Array.from(this.webhooks.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async getWebhook(id: string): Promise<Webhook | undefined> {
    return this.webhooks.get(id);
  }

  async createWebhook(
    insert: InsertWebhook & { secret: string },
  ): Promise<Webhook> {
    const webhook: Webhook = {
      id: randomUUID(),
      url: insert.url,
      secret: insert.secret,
      events: insert.events,
      active: true,
      createdAt: new Date(),
    };
    this.webhooks.set(webhook.id, webhook);
    return webhook;
  }

  async updateWebhook(
    id: string,
    update: UpdateWebhook,
  ): Promise<Webhook | undefined> {
    const existing = this.webhooks.get(id);
    if (!existing) return undefined;
    const merged: Webhook = {
      ...existing,
      ...(update.url !== undefined ? { url: update.url } : {}),
      ...(update.events !== undefined ? { events: update.events } : {}),
      ...(update.active !== undefined ? { active: update.active } : {}),
    };
    this.webhooks.set(id, merged);
    return merged;
  }

  async deleteWebhook(id: string): Promise<boolean> {
    return this.webhooks.delete(id);
  }

  // --- Webhook deliveries ------------------------------------------------------

  async getWebhookDeliveries(webhookId?: string): Promise<WebhookDelivery[]> {
    let out = this.deliveries;
    if (webhookId) out = out.filter((d) => d.webhookId === webhookId);
    return [...out]
      .sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime())
      .slice(0, 500);
  }

  async createWebhookDelivery(
    delivery: Omit<WebhookDelivery, "id" | "deliveredAt"> & {
      deliveredAt?: Date;
    },
  ): Promise<WebhookDelivery> {
    const record: WebhookDelivery = {
      ...delivery,
      id: randomUUID(),
      deliveredAt: delivery.deliveredAt ?? new Date(),
    };
    this.deliveries.push(record);
    return record;
  }

  // --- Releases (DaaS) --------------------------------------------------------

  async getReleases(publishedOnly = false): Promise<Release[]> {
    let out = Array.from(this.releases.values());
    if (publishedOnly) out = out.filter((r) => r.published);
    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getRelease(id: string): Promise<Release | undefined> {
    return this.releases.get(id);
  }

  async createRelease(
    release: Omit<Release, "id" | "createdAt" | "sha256" | "sizeBytes">,
  ): Promise<Release> {
    const data = Buffer.from(release.artifactData, "base64");
    const record: Release = {
      ...release,
      id: randomUUID(),
      sha256: sha256Hex(data),
      sizeBytes: data.length,
      createdAt: new Date(),
    };
    this.releases.set(record.id, record);
    return record;
  }

  async updateRelease(
    id: string,
    update: Partial<Pick<Release, "version" | "channel" | "notes" | "published">>,
  ): Promise<Release | undefined> {
    const existing = this.releases.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...update };
    this.releases.set(id, merged);
    return merged;
  }

  async deleteRelease(id: string): Promise<boolean> {
    return this.releases.delete(id);
  }

  // --- Licenses ---------------------------------------------------------------

  async getLicenses(): Promise<License[]> {
    return Array.from(this.licenses.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async getLicense(id: string): Promise<License | undefined> {
    return this.licenses.get(id);
  }

  async getLicenseByKey(key: string): Promise<License | undefined> {
    return Array.from(this.licenses.values()).find((l) => l.key === key);
  }

  async createLicense(
    license: Pick<License, "userId" | "label" | "maxDownloads" | "expiresAt">,
  ): Promise<License> {
    const record: License = {
      id: randomUUID(),
      key: `NEXUS-${randomUUID().toUpperCase()}`,
      userId: license.userId ?? null,
      label: license.label,
      status: "active",
      maxDownloads: license.maxDownloads,
      downloadsUsed: 0,
      expiresAt: license.expiresAt ?? null,
      createdAt: new Date(),
    };
    this.licenses.set(record.id, record);
    return record;
  }

  async updateLicense(
    id: string,
    update: Partial<Pick<License, "label" | "status" | "maxDownloads">>,
  ): Promise<License | undefined> {
    const existing = this.licenses.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...update };
    this.licenses.set(id, merged);
    return merged;
  }

  async incrementLicenseDownloads(id: string): Promise<void> {
    const existing = this.licenses.get(id);
    if (!existing) return;
    this.licenses.set(id, {
      ...existing,
      downloadsUsed: existing.downloadsUsed + 1,
    });
  }

  // --- Downloads ----------------------------------------------------------------

  async getDownloads(): Promise<Download[]> {
    return [...this.downloads].sort(
      (a, b) => b.downloadedAt.getTime() - a.downloadedAt.getTime(),
    );
  }

  async createDownload(
    download: Omit<Download, "id" | "downloadedAt">,
  ): Promise<Download> {
    const record: Download = {
      ...download,
      id: randomUUID(),
      downloadedAt: new Date(),
    };
    this.downloads.push(record);
    return record;
  }

  // --- Audit log / ledger ---------------------------------------------------------

  async appendAuditLog(
    entry: Omit<AuditLogEntry, "id" | "ts"> & { ts?: Date },
  ): Promise<AuditLogEntry> {
    const record: AuditLogEntry = {
      ...entry,
      id: randomUUID(),
      ts: entry.ts ?? new Date(),
    };
    this.auditLog.push(record);
    return record;
  }

  async getAuditLog(limit = 1000): Promise<AuditLogEntry[]> {
    return [...this.auditLog]
      .sort((a, b) => b.ts.getTime() - a.ts.getTime())
      .slice(0, limit);
  }

  async appendLedgerEntry(
    entry: Omit<LedgerEntry, "id" | "ts"> & { ts?: Date },
  ): Promise<LedgerEntry> {
    const record: LedgerEntry = {
      ...entry,
      id: randomUUID(),
      ts: entry.ts ?? new Date(),
    };
    this.ledger.push(record);
    return record;
  }

  async getLedgerEntries(limit = 1000): Promise<LedgerEntry[]> {
    return [...this.ledger]
      .sort((a, b) => b.ts.getTime() - a.ts.getTime())
      .slice(0, limit);
  }

  // --- Daily audits ----------------------------------------------------------------

  async getDailyAudits(): Promise<DailyAudit[]> {
    return Array.from(this.dailyAudits.values()).sort((a, b) =>
      b.date.localeCompare(a.date),
    );
  }

  async getDailyAudit(id: string): Promise<DailyAudit | undefined> {
    return this.dailyAudits.get(id);
  }

  async getDailyAuditByDate(date: string): Promise<DailyAudit | undefined> {
    return Array.from(this.dailyAudits.values()).find((a) => a.date === date);
  }

  async createDailyAudit(
    audit: Omit<
      DailyAudit,
      "id" | "createdAt" | "reviewedBy" | "reviewedAt" | "reviewNote"
    >,
  ): Promise<DailyAudit> {
    const record: DailyAudit = {
      ...audit,
      id: randomUUID(),
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: "",
      createdAt: new Date(),
    };
    this.dailyAudits.set(record.id, record);
    return record;
  }

  async reviewDailyAudit(
    id: string,
    decision: "approved" | "rejected",
    reviewer: string,
    note: string,
    checklist?: AuditChecklistItem[],
  ): Promise<DailyAudit | undefined> {
    const existing = this.dailyAudits.get(id);
    if (!existing) return undefined;
    const updated: DailyAudit = {
      ...existing,
      status: decision,
      reviewedBy: reviewer,
      reviewedAt: new Date(),
      reviewNote: note,
      ...(checklist ? { checklist } : {}),
    };
    this.dailyAudits.set(id, updated);
    return updated;
  }

  // --- Failover / resilience ---------------------------------------------------

  async getFailoverNodes(): Promise<FailoverNode[]> {
    return Array.from(this.failoverNodes.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async getFailoverNode(id: string): Promise<FailoverNode | undefined> {
    return this.failoverNodes.get(id);
  }

  async createFailoverNode(
    node: Pick<FailoverNode, "name" | "baseUrl" | "role" | "authToken">,
  ): Promise<FailoverNode> {
    const record: FailoverNode = {
      id: randomUUID(),
      name: node.name,
      baseUrl: node.baseUrl.replace(/\/$/, ""),
      role: node.role,
      authToken: node.authToken,
      status: "unreachable",
      lastHeartbeatAt: null,
      lastHeartbeatLatencyMs: null,
      lastSnapshotAt: null,
      consecutiveFailures: 0,
      enabled: true,
      createdAt: new Date(),
    };
    this.failoverNodes.set(record.id, record);
    return record;
  }

  async updateFailoverNode(
    id: string,
    update: Partial<
      Pick<
        FailoverNode,
        | "name"
        | "baseUrl"
        | "role"
        | "enabled"
        | "authToken"
        | "status"
        | "lastHeartbeatAt"
        | "lastHeartbeatLatencyMs"
        | "lastSnapshotAt"
        | "consecutiveFailures"
      >
    >,
  ): Promise<FailoverNode | undefined> {
    const existing = this.failoverNodes.get(id);
    if (!existing) return undefined;
    const merged: FailoverNode = {
      ...existing,
      ...update,
      ...(update.baseUrl ? { baseUrl: update.baseUrl.replace(/\/$/, "") } : {}),
    };
    this.failoverNodes.set(id, merged);
    return merged;
  }

  async deleteFailoverNode(id: string): Promise<boolean> {
    return this.failoverNodes.delete(id);
  }

  async getFallbackConfig(): Promise<FallbackConfig> {
    return this.fallbackConfig;
  }

  async updateFallbackConfig(
    update: Partial<FallbackConfig>,
    updatedBy: string,
  ): Promise<FallbackConfig> {
    this.fallbackConfig = {
      ...this.fallbackConfig,
      ...update,
      id: this.fallbackConfig.id,
      updatedAt: new Date(),
      updatedBy,
    };
    return this.fallbackConfig;
  }

  async appendFailoverEvent(
    event: Omit<FailoverEvent, "id" | "ts"> & { ts?: Date },
  ): Promise<FailoverEvent> {
    const record: FailoverEvent = {
      ...event,
      id: randomUUID(),
      ts: event.ts ?? new Date(),
    };
    this.failoverEvents.push(record);
    return record;
  }

  async getFailoverEvents(limit = 500): Promise<FailoverEvent[]> {
    return [...this.failoverEvents]
      .sort((a, b) => b.ts.getTime() - a.ts.getTime())
      .slice(0, limit);
  }
}

export const storage = new MemStorage();

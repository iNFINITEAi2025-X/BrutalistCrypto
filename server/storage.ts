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
} from "@shared/schema";
import { randomUUID } from "crypto";

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
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private strategies: Map<string, Strategy>;
  private trades: Trade[];
  private ticks: MarketTick[];
  private webhooks: Map<string, Webhook>;
  private deliveries: WebhookDelivery[];

  constructor() {
    this.users = new Map();
    this.strategies = new Map();
    this.trades = [];
    this.ticks = [];
    this.webhooks = new Map();
    this.deliveries = [];
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
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
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
}

export const storage = new MemStorage();

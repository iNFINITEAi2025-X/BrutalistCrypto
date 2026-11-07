import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  doublePrecision,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const USER_ROLES = ["admin", "user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginSchema>;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type PublicUser = Omit<User, "password">;

// ---------------------------------------------------------------------------
// TRADING ENGINE
// ---------------------------------------------------------------------------

export const ALGORITHMS = [
  "momentum",
  "mean_reversion",
  "grid",
  "breakout",
  "dca",
] as const;
export type AlgorithmType = (typeof ALGORITHMS)[number];

export const STRATEGY_STATUSES = ["running", "stopped"] as const;
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];

export const TRADE_SIDES = ["BUY", "SELL"] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

export const TRADE_MODES = ["live", "simulated", "backtest"] as const;
export type TradeMode = (typeof TRADE_MODES)[number];

export const WEBHOOK_EVENTS = [
  "trade.executed",
  "strategy.started",
  "strategy.stopped",
  "backtest.completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// --- Algorithm parameter schemas (see readme.md §2) -------------------------

export const momentumParamsSchema = z.object({
  fastPeriod: z.number().int().min(1).default(5),
  slowPeriod: z.number().int().min(2).default(20),
  rsiPeriod: z.number().int().min(2).default(14),
  rsiOverbought: z.number().min(1).max(100).default(70),
  rsiOversold: z.number().min(0).max(99).default(30),
  minVolume: z.number().min(0).default(0),
  orderSize: z.number().positive().default(1),
});

export const meanReversionParamsSchema = z.object({
  lookbackPeriod: z.number().int().min(2).default(20),
  entryStdDev: z.number().positive().default(2.0),
  exitStdDev: z.number().positive().default(0.5),
  maxHoldTicks: z.number().int().min(1).default(100),
  orderSize: z.number().positive().default(1),
});

export const gridParamsSchema = z.object({
  gridLevels: z.number().int().min(2).default(10),
  lowerPrice: z.number().min(0).default(0),
  upperPrice: z.number().min(0).default(0),
  rangePct: z.number().positive().default(10),
  orderSize: z.number().positive().default(1),
});

export const breakoutParamsSchema = z.object({
  channelPeriod: z.number().int().min(2).default(20),
  confirmationTicks: z.number().int().min(1).default(2),
  orderSize: z.number().positive().default(1),
});

export const dcaParamsSchema = z.object({
  intervalTicks: z.number().int().min(1).default(10),
  orderSize: z.number().positive().default(1),
  takeProfitPct: z.number().min(0).default(0),
});

export const algorithmParamsSchema = z.union([
  momentumParamsSchema,
  meanReversionParamsSchema,
  gridParamsSchema,
  breakoutParamsSchema,
  dcaParamsSchema,
]);

export type MomentumParams = z.infer<typeof momentumParamsSchema>;
export type MeanReversionParams = z.infer<typeof meanReversionParamsSchema>;
export type GridParams = z.infer<typeof gridParamsSchema>;
export type BreakoutParams = z.infer<typeof breakoutParamsSchema>;
export type DcaParams = z.infer<typeof dcaParamsSchema>;
export type AlgorithmParams = z.infer<typeof algorithmParamsSchema>;

export const paramsSchemaForAlgorithm: Record<
  AlgorithmType,
  z.ZodTypeAny
> = {
  momentum: momentumParamsSchema,
  mean_reversion: meanReversionParamsSchema,
  grid: gridParamsSchema,
  breakout: breakoutParamsSchema,
  dca: dcaParamsSchema,
};

export const defaultParamsForAlgorithm: Record<AlgorithmType, AlgorithmParams> =
  {
    momentum: momentumParamsSchema.parse({}),
    mean_reversion: meanReversionParamsSchema.parse({}),
    grid: gridParamsSchema.parse({}),
    breakout: breakoutParamsSchema.parse({}),
    dca: dcaParamsSchema.parse({}),
  };

// Shared risk limits applied to every strategy.
export const riskLimitsSchema = z.object({
  maxPositionSize: z.number().positive().default(10),
  maxNotionalUsd: z.number().positive().default(100_000),
  feeBps: z.number().min(0).default(10),
  slippageBps: z.number().min(0).default(5),
  cooldownMs: z.number().int().min(0).default(0),
});
export type RiskLimits = z.infer<typeof riskLimitsSchema>;

// --- Tables -----------------------------------------------------------------

export const strategies = pgTable("strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  algorithm: text("algorithm").notNull(),
  params: jsonb("params").notNull(),
  riskLimits: jsonb("risk_limits").notNull(),
  status: text("status").notNull().default("stopped"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStrategySchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1),
  algorithm: z.enum(ALGORITHMS),
  params: z.record(z.string(), z.number()).default({}),
  riskLimits: z.record(z.string(), z.number()).default({}),
});

export const updateStrategySchema = z.object({
  name: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  params: z.record(z.string(), z.number()).optional(),
  riskLimits: z.record(z.string(), z.number()).optional(),
});

export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type UpdateStrategy = z.infer<typeof updateStrategySchema>;
export type Strategy = typeof strategies.$inferSelect;

export const trades = pgTable("trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  price: doublePrecision("price").notNull(),
  notionalUsd: doublePrecision("notional_usd").notNull(),
  feeUsd: doublePrecision("fee_usd").notNull(),
  pnlUsd: doublePrecision("pnl_usd").notNull().default(0),
  mode: text("mode").notNull().default("simulated"),
  signal: text("signal").notNull().default(""),
  executedAt: timestamp("executed_at").notNull().defaultNow(),
});

export type Trade = typeof trades.$inferSelect;

export const marketTicks = pgTable("market_ticks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  price: doublePrecision("price").notNull(),
  volume: doublePrecision("volume").notNull().default(0),
  ts: timestamp("ts").notNull().defaultNow(),
});

export const insertTickSchema = z.object({
  symbol: z.string().min(1),
  price: z.number().positive(),
  volume: z.number().min(0).default(0),
});
export type InsertTick = z.infer<typeof insertTickSchema>;
export type MarketTick = typeof marketTicks.$inferSelect;

export const webhooks = pgTable("webhooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  secret: z.string().min(1).optional(),
});

export const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  active: z.boolean().optional(),
});

export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type UpdateWebhook = z.infer<typeof updateWebhookSchema>;
export type Webhook = typeof webhooks.$inferSelect;

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webhookId: varchar("webhook_id").notNull(),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  httpStatus: integer("http_status"),
  attempts: integer("attempts").notNull().default(0),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  deliveredAt: timestamp("delivered_at").notNull().defaultNow(),
});

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

// --- Backtest ----------------------------------------------------------------

export const backtestRequestSchema = z.object({
  strategyId: z.string().min(1),
  ticks: z.number().int().min(10).max(100_000).default(500),
  startPrice: z.number().positive().default(50_000),
  volatilityPct: z.number().min(0).max(100).default(1.5),
  trendPct: z.number().min(-100).max(100).default(0),
});
export type BacktestRequest = z.infer<typeof backtestRequestSchema>;

export const simulateRequestSchema = z.object({
  symbol: z.string().min(1).default("BTC/USDT"),
  ticks: z.number().int().min(1).max(10_000).default(100),
  startPrice: z.number().positive().default(50_000),
  volatilityPct: z.number().min(0).max(100).default(1.5),
  trendPct: z.number().min(-100).max(100).default(0),
});
export type SimulateRequest = z.infer<typeof simulateRequestSchema>;

export interface BacktestSummary {
  strategyId: string;
  symbol: string;
  ticks: number;
  totalTrades: number;
  buys: number;
  sells: number;
  winRate: number;
  totalPnlUsd: number;
  totalFeesUsd: number;
  maxDrawdownUsd: number;
  sharpe: number;
  finalPosition: number;
  tradeIds: string[];
}

// ---------------------------------------------------------------------------
// DAAS — distribution, licensing, bookkeeping & audits
// ---------------------------------------------------------------------------

export const releases = pgTable("releases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  version: text("version").notNull(),
  channel: text("channel").notNull().default("stable"),
  notes: text("notes").notNull().default(""),
  artifactName: text("artifact_name").notNull(),
  artifactData: text("artifact_data").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  published: boolean("published").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReleaseSchema = z.object({
  version: z.string().min(1),
  channel: z.string().min(1).default("stable"),
  notes: z.string().default(""),
  artifactName: z.string().min(1),
  artifactData: z.string().min(1), // base64-encoded artifact
  published: z.boolean().default(true),
});
export const updateReleaseSchema = z.object({
  version: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  notes: z.string().optional(),
  published: z.boolean().optional(),
});
export type InsertRelease = z.infer<typeof insertReleaseSchema>;
export type UpdateRelease = z.infer<typeof updateReleaseSchema>;
export type Release = typeof releases.$inferSelect;
/** Release shape exposed publicly — never includes artifactData. */
export type PublicRelease = Omit<Release, "artifactData">;

export const LICENSE_STATUSES = ["active", "revoked"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const licenses = pgTable("licenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  userId: varchar("user_id"),
  label: text("label").notNull().default(""),
  status: text("status").notNull().default("active"),
  maxDownloads: integer("max_downloads").notNull().default(0), // 0 = unlimited
  downloadsUsed: integer("downloads_used").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLicenseSchema = z.object({
  userId: z.string().min(1).optional(),
  label: z.string().default(""),
  maxDownloads: z.number().int().min(0).default(0),
  expiresAt: z.string().datetime().optional(),
});
export const updateLicenseSchema = z.object({
  label: z.string().optional(),
  status: z.enum(LICENSE_STATUSES).optional(),
  maxDownloads: z.number().int().min(0).optional(),
});
export type InsertLicense = z.infer<typeof insertLicenseSchema>;
export type UpdateLicense = z.infer<typeof updateLicenseSchema>;
export type License = typeof licenses.$inferSelect;

export const downloads = pgTable("downloads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  releaseId: varchar("release_id").notNull(),
  licenseId: varchar("license_id"),
  userId: varchar("user_id"),
  ip: text("ip").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  downloadedAt: timestamp("downloaded_at").notNull().defaultNow(),
});
export type Download = typeof downloads.$inferSelect;

export const AUDIT_SEVERITIES = ["info", "warning", "critical"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

/** Immutable bookkeeping/audit event written by the AI bookkeeper & system. */
export const auditLog = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts").notNull().defaultNow(),
  actor: text("actor").notNull().default("system"), // username | "system" | "ai-bookkeeper"
  action: text("action").notNull(),
  entity: text("entity").notNull().default(""),
  entityId: text("entity_id").notNull().default(""),
  detail: jsonb("detail").notNull().default({}),
  severity: text("severity").notNull().default("info"),
});
export type AuditLogEntry = typeof auditLog.$inferSelect;

/** AI bookkeeper account ledger entries (double-entry style lines). */
export const LEDGER_CATEGORIES = [
  "fees",
  "pnl",
  "distribution",
  "operations",
] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];

export const ledgerEntries = pgTable("ledger_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts").notNull().defaultNow(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amountUsd: doublePrecision("amount_usd").notNull(),
  reference: text("reference").notNull().default(""),
  createdBy: text("created_by").notNull().default("ai-bookkeeper"),
});
export type LedgerEntry = typeof ledgerEntries.$inferSelect;

export const DAILY_AUDIT_STATUSES = ["pending", "approved", "rejected"] as const;
export type DailyAuditStatus = (typeof DAILY_AUDIT_STATUSES)[number];

export const CHECKLIST_ITEM_STATUSES = [
  "pending",
  "passed",
  "failed",
] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

export interface AuditChecklistItem {
  key: string;
  label: string;
  status: ChecklistItemStatus;
  detail: string;
}

/** One row per day: automated system audit + admin approval checklist. */
export const dailyAudits = pgTable("daily_audits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull().unique(), // YYYY-MM-DD (UTC)
  status: text("status").notNull().default("pending"),
  checklist: jsonb("checklist").notNull(), // AuditChecklistItem[]
  totals: jsonb("totals").notNull().default({}),
  anomalyCount: integer("anomaly_count").notNull().default(0),
  generatedBy: text("generated_by").notNull().default("ai-bookkeeper"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reviewDailyAuditSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  checklist: z
    .array(
      z.object({
        key: z.string().min(1),
        status: z.enum(["passed", "failed"]),
      }),
    )
    .optional(),
  note: z.string().default(""),
});
export type ReviewDailyAuditRequest = z.infer<typeof reviewDailyAuditSchema>;
export type DailyAudit = typeof dailyAudits.$inferSelect;

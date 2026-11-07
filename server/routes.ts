import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { storage, type MemStorage } from "./storage";
import {
  insertStrategySchema,
  updateStrategySchema,
  insertTickSchema,
  insertWebhookSchema,
  updateWebhookSchema,
  backtestRequestSchema,
  simulateRequestSchema,
  paramsSchemaForAlgorithm,
  riskLimitsSchema,
  defaultParamsForAlgorithm,
  loginSchema,
  insertReleaseSchema,
  updateReleaseSchema,
  insertLicenseSchema,
  updateLicenseSchema,
  reviewDailyAuditSchema,
  type Strategy,
  type MarketTick,
  type Trade,
} from "@shared/schema";
import {
  TradingEngine,
  buildTradeRecord,
  generateTickSeries,
  runBacktest,
} from "./trading/engine";
import { dispatchEvent, sendTestPing } from "./webhooks/dispatcher";
import { login, requireAdmin, requireAuth, toPublicUser } from "./auth";
import {
  ensureDailyAudit,
  generateDailyAudit,
  postDistributionToLedger,
  postTradeToLedger,
  runSystemAudit,
} from "./audit/bookkeeper";

function auditActor(req: Request): string {
  return req.user?.username ?? "anonymous";
}

async function audit(
  req: Request,
  action: string,
  entity: string,
  entityId: string,
  detail: Record<string, unknown> = {},
  severity: "info" | "warning" | "critical" = "info",
) {
  await storage.appendAuditLog({
    actor: auditActor(req),
    action,
    entity,
    entityId,
    detail,
    severity,
  });
}

// Live engine instances, keyed by strategy id. An engine exists while a
// strategy is `running` and is destroyed when the strategy stops.
const engines = new Map<string, TradingEngine>();

function engineFor(strategy: Strategy): TradingEngine {
  let engine = engines.get(strategy.id);
  if (!engine) {
    const { params, risk } = TradingEngine.resolveParams(strategy);
    engine = new TradingEngine(strategy, params, risk);
    engines.set(strategy.id, engine);
  }
  return engine;
}

/**
 * Feed one tick into every running strategy on that symbol.
 * Any resulting signals are executed and appended to the trades log.
 */
async function processTick(tick: MarketTick, mode: "live" | "simulated") {
  const strategies = await storage.getStrategies();
  const active = strategies.filter(
    (s) => s.status === "running" && s.symbol === tick.symbol,
  );
  for (const strategy of active) {
    try {
      const engine = engineFor(strategy);
      const { risk } = TradingEngine.resolveParams(strategy);
      const signal = engine.onTick(tick);
      if (!signal) continue;
      const record = buildTradeRecord(strategy, signal, tick, risk, mode);
      const trade: Trade = await storage.createTrade(record);
      void postTradeToLedger(trade).catch(() => {});
      dispatchEvent("trade.executed", trade);
    } catch (err) {
      console.error(
        `[engine] strategy ${strategy.id} tick error:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

function badRequest(res: Response, message: string) {
  return res.status(400).json({ message });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // -------------------------------------------------------------------------
  // Strategies
  // -------------------------------------------------------------------------

  app.get("/api/strategies", async (_req, res) => {
    res.json(await storage.getStrategies());
  });

  app.get("/api/strategies/:id", async (req, res) => {
    const strategy = await storage.getStrategy(req.params.id);
    if (!strategy) return res.status(404).json({ message: "Not found" });
    res.json(strategy);
  });

  app.post("/api/strategies", async (req, res) => {
    const parsed = insertStrategySchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    // Merge defaults + validate algorithm params and risk limits
    const defaults = defaultParamsForAlgorithm[parsed.data.algorithm];
    try {
      paramsSchemaForAlgorithm[parsed.data.algorithm].parse({
        ...(defaults as Record<string, number>),
        ...parsed.data.params,
      });
      riskLimitsSchema.parse(parsed.data.riskLimits);
    } catch (err) {
      return badRequest(
        res,
        err instanceof Error ? err.message : "invalid parameters",
      );
    }
    const strategy = await storage.createStrategy(parsed.data);
    res.status(201).json(strategy);
  });

  app.patch("/api/strategies/:id", async (req, res) => {
    const parsed = updateStrategySchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const existing = await storage.getStrategy(req.params.id);
    if (!existing) return res.status(404).json({ message: "Not found" });

    // Validate merged params before persisting
    const mergedParams = {
      ...(existing.params as Record<string, number>),
      ...(parsed.data.params ?? {}),
    };
    const mergedRisk = {
      ...(existing.riskLimits as Record<string, number>),
      ...(parsed.data.riskLimits ?? {}),
    };
    try {
      paramsSchemaForAlgorithm[
        existing.algorithm as keyof typeof paramsSchemaForAlgorithm
      ].parse(mergedParams);
      riskLimitsSchema.parse(mergedRisk);
    } catch (err) {
      return badRequest(
        res,
        err instanceof Error ? err.message : "invalid parameters",
      );
    }

    const updated = await storage.updateStrategy(req.params.id, parsed.data);
    res.json(updated);
  });

  app.delete("/api/strategies/:id", async (req, res) => {
    engines.delete(req.params.id);
    const ok = await storage.deleteStrategy(req.params.id);
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.status(204).end();
  });

  app.post("/api/strategies/:id/start", async (req, res) => {
    const strategy = await storage.getStrategy(req.params.id);
    if (!strategy) return res.status(404).json({ message: "Not found" });
    const updated = await (storage as MemStorage).setStrategyStatus(
      strategy.id,
      "running",
    );
    if (updated) engineFor(updated); // warm the engine
    dispatchEvent("strategy.started", updated);
    res.json(updated);
  });

  app.post("/api/strategies/:id/stop", async (req, res) => {
    const strategy = await storage.getStrategy(req.params.id);
    if (!strategy) return res.status(404).json({ message: "Not found" });
    const updated = await (storage as MemStorage).setStrategyStatus(
      strategy.id,
      "stopped",
    );
    engines.delete(strategy.id);
    dispatchEvent("strategy.stopped", updated);
    res.json(updated);
  });

  // -------------------------------------------------------------------------
  // Trades log
  // -------------------------------------------------------------------------

  app.get("/api/trades", async (req, res) => {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "500"), 10) || 500, 1),
      5000,
    );
    const trades = await storage.getTrades({
      strategyId: req.query.strategyId as string | undefined,
      symbol: req.query.symbol as string | undefined,
      mode: req.query.mode as string | undefined,
      limit,
    });
    res.json(trades);
  });

  app.get("/api/trades/stats", async (req, res) => {
    const trades = await storage.getTrades({
      strategyId: req.query.strategyId as string | undefined,
      limit: 100_000,
    });
    const sells = trades.filter((t) => t.side === "SELL");
    const wins = sells.filter((t) => t.pnlUsd > 0).length;
    const totalPnl = trades.reduce((a, t) => a + t.pnlUsd, 0);
    const totalFees = trades.reduce((a, t) => a + t.feeUsd, 0);
    const volume = trades.reduce((a, t) => a + t.notionalUsd, 0);
    res.json({
      totalTrades: trades.length,
      buys: trades.length - sells.length,
      sells: sells.length,
      winRate: sells.length > 0 ? wins / sells.length : 0,
      totalPnlUsd: totalPnl,
      totalFeesUsd: totalFees,
      totalVolumeUsd: volume,
    });
  });

  // -------------------------------------------------------------------------
  // Market data
  // -------------------------------------------------------------------------

  app.get("/api/market/ticks", async (req, res) => {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "500"), 10) || 500, 1),
      5000,
    );
    res.json(
      await storage.getTicks(req.query.symbol as string | undefined, limit),
    );
  });

  app.post("/api/market/ticks", async (req, res) => {
    const parsed = insertTickSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const tick = await storage.createTick(parsed.data);
    await processTick(tick, "live");
    res.status(201).json(tick);
  });

  app.post("/api/market/simulate", async (req, res) => {
    const parsed = simulateRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { symbol, ticks, startPrice, volatilityPct, trendPct } = parsed.data;
    const series = generateTickSeries(
      symbol,
      ticks,
      startPrice,
      volatilityPct,
      trendPct,
    );
    const beforeLatest = (await storage.getTrades({ limit: 1 }))[0]?.id;
    for (const t of series) {
      const tick = await storage.createTick(t);
      await processTick(tick, "simulated");
    }
    // Trades are sorted newest-first; count those appended during this run.
    let signals = 0;
    for (const tr of await storage.getTrades({ limit: 100_000 })) {
      if (beforeLatest !== undefined && tr.id === beforeLatest) break;
      signals++;
    }
    res.json({
      symbol,
      ticksIngested: series.length,
      signalsFired: signals,
      lastPrice: series[series.length - 1]?.price ?? startPrice,
    });
  });

  // -------------------------------------------------------------------------
  // Backtests
  // -------------------------------------------------------------------------

  app.post("/api/backtests", async (req, res) => {
    const parsed = backtestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const strategy = await storage.getStrategy(parsed.data.strategyId);
    if (!strategy) return res.status(404).json({ message: "Strategy not found" });

    const series = generateTickSeries(
      strategy.symbol,
      parsed.data.ticks,
      parsed.data.startPrice,
      parsed.data.volatilityPct,
      parsed.data.trendPct,
    );
    const { trades, summary } = runBacktest(strategy, series);

    // Persist backtest trades into the trades log
    const tradeIds: string[] = [];
    for (const t of trades) {
      const record = await storage.createTrade({
        strategyId: strategy.id,
        symbol: strategy.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        notionalUsd: t.quantity * t.price,
        feeUsd: t.feeUsd,
        pnlUsd: t.pnlUsd,
        mode: "backtest",
        signal: t.reason,
      });
      tradeIds.push(record.id);
      void postTradeToLedger(record).catch(() => {});
      dispatchEvent("trade.executed", record);
    }

    const result = { ...summary, tradeIds };
    dispatchEvent("backtest.completed", result);
    res.json(result);
  });

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  app.get("/api/webhooks", async (_req, res) => {
    res.json(await storage.getWebhooks());
  });

  app.post("/api/webhooks", async (req, res) => {
    const parsed = insertWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const webhook = await storage.createWebhook({
      ...parsed.data,
      secret: parsed.data.secret ?? randomUUID(),
    });
    res.status(201).json(webhook);
  });

  app.patch("/api/webhooks/:id", async (req, res) => {
    const parsed = updateWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const updated = await storage.updateWebhook(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.delete("/api/webhooks/:id", async (req, res) => {
    const ok = await storage.deleteWebhook(req.params.id);
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.status(204).end();
  });

  app.get("/api/webhooks/:id/deliveries", async (req, res) => {
    const webhook = await storage.getWebhook(req.params.id);
    if (!webhook) return res.status(404).json({ message: "Not found" });
    res.json(await storage.getWebhookDeliveries(webhook.id));
  });

  app.post("/api/webhooks/:id/test", async (req, res) => {
    const webhook = await storage.getWebhook(req.params.id);
    if (!webhook) return res.status(404).json({ message: "Not found" });
    const delivery = await sendTestPing(webhook);
    res.json({ sent: true, delivery });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, "username and password required");
    }
    const user = await login(parsed.data.username, parsed.data.password);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    req.session.userId = user.id;
    await audit(req, "auth.login", "user", user.id, { username: user.username });
    res.json(toPublicUser(user));
  });

  app.post("/api/auth/logout", async (req, res) => {
    const userId = req.session.userId;
    req.session.destroy(() => {});
    if (userId) await audit(req, "auth.logout", "user", userId);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Not authenticated" });
    res.json(toPublicUser(req.user));
  });

  // -------------------------------------------------------------------------
  // DAAS — public distribution endpoints
  // -------------------------------------------------------------------------

  // List published releases (artifact payload never included).
  app.get("/api/releases", async (_req, res) => {
    const releases = await storage.getReleases(true);
    res.json(
      releases.map(({ artifactData: _a, ...pub }) => pub),
    );
  });

  // Download an artifact. Requires auth; a valid license key may be supplied
  // via `?key=` or the `X-Nexus-License` header to record against a license.
  app.get("/api/releases/:id/download", requireAuth, async (req, res) => {
    const release = await storage.getRelease(req.params.id);
    if (!release || !release.published) {
      return res.status(404).json({ message: "Release not found" });
    }

    const key = (req.query.key as string | undefined) ?? req.get("X-Nexus-License") ?? undefined;
    let licenseId: string | null = null;
    if (key) {
      const license = await storage.getLicenseByKey(key);
      if (!license) return res.status(403).json({ message: "Invalid license key" });
      if (license.status !== "active") {
        return res.status(403).json({ message: "License is not active" });
      }
      if (license.expiresAt && new Date(license.expiresAt).getTime() < Date.now()) {
        return res.status(403).json({ message: "License expired" });
      }
      if (license.maxDownloads > 0 && license.downloadsUsed >= license.maxDownloads) {
        return res.status(403).json({ message: "License download limit reached" });
      }
      licenseId = license.id;
      await storage.incrementLicenseDownloads(license.id);
    }

    await storage.createDownload({
      releaseId: release.id,
      licenseId,
      userId: req.user!.id,
      ip: req.ip ?? "",
      userAgent: req.get("user-agent") ?? "",
    });
    await audit(req, "daas.download", "release", release.id, {
      version: release.version,
      licenseId,
    });
    void postDistributionToLedger(
      `Download of ${release.artifactName} (${release.version}) by ${req.user!.username}`,
      `release:${release.id}`,
    ).catch(() => {});

    const data = Buffer.from(release.artifactData, "base64");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${release.artifactName.replace(/"/g, "")}"`,
    );
    res.setHeader("X-Nexus-SHA256", release.sha256);
    res.send(data);
  });

  // -------------------------------------------------------------------------
  // Admin — users
  // -------------------------------------------------------------------------

  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    const users = await storage.listUsers();
    res.json(users.map(toPublicUser));
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const role = req.body?.role;
    if (role !== "admin" && role !== "user") {
      return badRequest(res, "role must be 'admin' or 'user'");
    }
    const updated = await storage.updateUserRole(req.params.id, role);
    if (!updated) return res.status(404).json({ message: "Not found" });
    await audit(req, "admin.user_role", "user", updated.id, { role });
    res.json(toPublicUser(updated));
  });

  // -------------------------------------------------------------------------
  // Admin — releases
  // -------------------------------------------------------------------------

  app.get("/api/admin/releases", requireAdmin, async (_req, res) => {
    const releases = await storage.getReleases();
    res.json(releases.map(({ artifactData: _a, ...pub }) => pub));
  });

  app.post("/api/admin/releases", requireAdmin, async (req, res) => {
    const parsed = insertReleaseSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    // Validate base64 payload decodes
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(parsed.data.artifactData)) {
      return badRequest(res, "artifactData must be base64");
    }
    const release = await storage.createRelease(parsed.data);
    await audit(req, "daas.release_created", "release", release.id, {
      version: release.version,
      channel: release.channel,
      sizeBytes: release.sizeBytes,
    });
    void postDistributionToLedger(
      `Release ${release.version} published to channel ${release.channel}`,
      `release:${release.id}`,
    ).catch(() => {});
    const { artifactData: _a, ...pub } = release;
    res.status(201).json(pub);
  });

  app.patch("/api/admin/releases/:id", requireAdmin, async (req, res) => {
    const parsed = updateReleaseSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const updated = await storage.updateRelease(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Not found" });
    await audit(req, "daas.release_updated", "release", updated.id, parsed.data);
    const { artifactData: _a, ...pub } = updated;
    res.json(pub);
  });

  app.delete("/api/admin/releases/:id", requireAdmin, async (req, res) => {
    const ok = await storage.deleteRelease(req.params.id);
    if (!ok) return res.status(404).json({ message: "Not found" });
    await audit(req, "daas.release_deleted", "release", req.params.id, {}, "warning");
    res.status(204).end();
  });

  // -------------------------------------------------------------------------
  // Admin — licenses
  // -------------------------------------------------------------------------

  app.get("/api/admin/licenses", requireAdmin, async (_req, res) => {
    res.json(await storage.getLicenses());
  });

  app.post("/api/admin/licenses", requireAdmin, async (req, res) => {
    const parsed = insertLicenseSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const license = await storage.createLicense({
      userId: parsed.data.userId ?? null,
      label: parsed.data.label,
      maxDownloads: parsed.data.maxDownloads,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    });
    await audit(req, "daas.license_created", "license", license.id, {
      label: license.label,
    });
    res.status(201).json(license);
  });

  app.patch("/api/admin/licenses/:id", requireAdmin, async (req, res) => {
    const parsed = updateLicenseSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const updated = await storage.updateLicense(req.params.id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Not found" });
    await audit(req, "daas.license_updated", "license", updated.id, parsed.data);
    res.json(updated);
  });

  // -------------------------------------------------------------------------
  // Admin — downloads
  // -------------------------------------------------------------------------

  app.get("/api/admin/downloads", requireAdmin, async (_req, res) => {
    res.json(await storage.getDownloads());
  });

  // -------------------------------------------------------------------------
  // Admin — audit log, ledger, system audits, daily audit approval
  // -------------------------------------------------------------------------

  app.get("/api/admin/audit-log", requireAdmin, async (req, res) => {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "500"), 10) || 500, 1),
      5000,
    );
    res.json(await storage.getAuditLog(limit));
  });

  app.get("/api/admin/ledger", requireAdmin, async (req, res) => {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "500"), 10) || 500, 1),
      5000,
    );
    res.json(await storage.getLedgerEntries(limit));
  });

  app.post("/api/admin/audits/run", requireAdmin, async (req, res) => {
    const findings = await runSystemAudit();
    await audit(req, "audit.system.manual_run", "audit_log", "", {
      findings: findings.length,
    });
    res.json({ findings, count: findings.length });
  });

  app.get("/api/admin/audits/daily", requireAdmin, async (_req, res) => {
    await ensureDailyAudit();
    res.json(await storage.getDailyAudits());
  });

  app.get("/api/admin/audits/daily/:id", requireAdmin, async (req, res) => {
    const auditRow = await storage.getDailyAudit(req.params.id);
    if (!auditRow) return res.status(404).json({ message: "Not found" });
    res.json(auditRow);
  });

  app.post("/api/admin/audits/daily/generate", requireAdmin, async (req, res) => {
    const date =
      typeof req.body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
        ? req.body.date
        : undefined;
    const auditRow = await generateDailyAudit(date);
    await audit(req, "audit.daily.manual_generate", "daily_audit", auditRow.id, {
      date: auditRow.date,
    });
    res.status(201).json(auditRow);
  });

  app.post("/api/admin/audits/daily/:id/review", requireAdmin, async (req, res) => {
    const parsed = reviewDailyAuditSchema.safeParse(req.body);
    if (!parsed.success) {
      return badRequest(res, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const existing = await storage.getDailyAudit(req.params.id);
    if (!existing) return res.status(404).json({ message: "Not found" });

    // Apply admin checklist overrides if provided
    let checklist = existing.checklist as import("@shared/schema").AuditChecklistItem[];
    if (parsed.data.checklist) {
      checklist = checklist.map((item) => {
        const override = parsed.data.checklist!.find((c) => c.key === item.key);
        return override ? { ...item, status: override.status } : item;
      });
    }

    const updated = await storage.reviewDailyAudit(
      existing.id,
      parsed.data.decision,
      req.user!.username,
      parsed.data.note,
      checklist,
    );
    await audit(
      req,
      `audit.daily.${parsed.data.decision}`,
      "daily_audit",
      existing.id,
      { date: existing.date, note: parsed.data.note },
      parsed.data.decision === "rejected" ? "warning" : "info",
    );
    res.json(updated);
  });

  return httpServer;
}

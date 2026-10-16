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

  return httpServer;
}

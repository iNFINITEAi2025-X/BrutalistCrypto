import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { backtest, simulateCandles, PaperTrader } from "./trading/engine";

const trader = new PaperTrader();

const settings = z.object({
  fast: z.number().int().min(1).max(200).default(5),
  slow: z.number().int().min(2).max(400).default(20),
  startingCash: z.number().positive().max(1e9).default(10000),
  feePct: z.number().min(0).lt(100).default(0.1),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const handle = (fn: (req: any, res: any) => void) => (req: any, res: any) => {
    try { fn(req, res); } catch (e: any) {
      res.status(400).json({ message: e?.message ?? "bad request" });
    }
  };

  app.get("/api/paper", (_req, res) => res.json(trader.state()));
  app.post("/api/paper/start", handle((_req, res) => { trader.start(); res.json(trader.state()); }));
  app.post("/api/paper/stop", handle((_req, res) => { trader.stop(); res.json(trader.state()); }));
  app.post("/api/paper/reset", handle((_req, res) => { trader.stop(); trader.reset(); res.json(trader.state()); }));
  app.post("/api/paper/settings", handle((req, res) => {
    const s = settings.parse(req.body ?? {});
    trader.configure(s.fast, s.slow, s.startingCash, s.feePct);
    res.json(trader.state());
  }));

  app.post("/api/backtest", handle((req, res) => {
    const body = settings.extend({
      candles: z.number().int().min(50).max(20000).default(1000),
      seed: z.number().int().default(1),
    }).parse(req.body ?? {});
    const result = backtest(simulateCandles(body.candles, body.seed), body);
    res.json({ simulated: true, ...result, equity: result.equity.filter((_, i) => i % Math.ceil(result.equity.length / 300) === 0) });
  }));

  return httpServer;
}

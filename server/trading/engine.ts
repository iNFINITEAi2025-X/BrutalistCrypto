import {
  type AlgorithmParams,
  type BacktestSummary,
  type MarketTick,
  type RiskLimits,
  type Strategy,
  type Trade,
  type TradeMode,
  type TradeSide,
  breakoutParamsSchema,
  dcaParamsSchema,
  gridParamsSchema,
  meanReversionParamsSchema,
  momentumParamsSchema,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function stdDev(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const window = values.slice(values.length - period);
  const mean = window.reduce((a, b) => a + b, 0) / period;
  const variance =
    window.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / period;
  return Math.sqrt(variance);
}

function rsi(values: number[], period: number): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  if (losses === 0) return 100;
  const rs = gains / period / (losses / period);
  return 100 - 100 / (1 + rs);
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export interface Signal {
  side: TradeSide;
  quantity: number;
  reason: string;
  /** Position average entry price captured before this signal mutates state. */
  entryPrice: number;
}

interface AlgoState {
  prices: number[];
  position: number;
  avgEntryPrice: number;
  ticksInPosition: number;
  lastCross: -1 | 0 | 1;
  gridLevels: number[] | null;
  lastGridIndex: number | null;
  consecutiveAbove: number;
  consecutiveBelow: number;
  ticksSinceLastBuy: number;
  lastTradeAt: number;
}

function freshState(): AlgoState {
  return {
    prices: [],
    position: 0,
    avgEntryPrice: 0,
    ticksInPosition: 0,
    lastCross: 0,
    gridLevels: null,
    lastGridIndex: null,
    consecutiveAbove: 0,
    consecutiveBelow: 0,
    ticksSinceLastBuy: Number.MAX_SAFE_INTEGER,
    lastTradeAt: 0,
  };
}

// ---------------------------------------------------------------------------
// TradingEngine — one instance per strategy
// ---------------------------------------------------------------------------

export class TradingEngine {
  private state: AlgoState = freshState();

  constructor(
    private readonly strategy: Strategy,
    private readonly params: AlgorithmParams,
    private readonly risk: RiskLimits,
  ) {}

  get position(): number {
    return this.state.position;
  }

  /** Parse params for this strategy's algorithm, applying defaults. */
  static resolveParams(strategy: Strategy): {
    params: AlgorithmParams;
    risk: RiskLimits;
  } {
    const raw = (strategy.params ?? {}) as Record<string, number>;
    const rawRisk = (strategy.riskLimits ?? {}) as Record<string, number>;
    let params: AlgorithmParams;
    switch (strategy.algorithm) {
      case "momentum":
        params = momentumParamsSchema.parse(raw);
        break;
      case "mean_reversion":
        params = meanReversionParamsSchema.parse(raw);
        break;
      case "grid":
        params = gridParamsSchema.parse(raw);
        break;
      case "breakout":
        params = breakoutParamsSchema.parse(raw);
        break;
      case "dca":
        params = dcaParamsSchema.parse(raw);
        break;
      default:
        throw new Error(`unknown algorithm: ${strategy.algorithm}`);
    }
    const risk: RiskLimits = {
      maxPositionSize:
        typeof rawRisk.maxPositionSize === "number"
          ? rawRisk.maxPositionSize
          : 10,
      maxNotionalUsd:
        typeof rawRisk.maxNotionalUsd === "number"
          ? rawRisk.maxNotionalUsd
          : 100_000,
      feeBps: typeof rawRisk.feeBps === "number" ? rawRisk.feeBps : 10,
      slippageBps:
        typeof rawRisk.slippageBps === "number" ? rawRisk.slippageBps : 5,
      cooldownMs:
        typeof rawRisk.cooldownMs === "number" ? rawRisk.cooldownMs : 0,
    };
    return { params, risk };
  }

  /**
   * Process one market tick. Returns a signal when the algorithm fires,
   * or null when no action should be taken.
   */
  onTick(tick: MarketTick): Signal | null {
    const s = this.state;
    const price = tick.price;
    const now = tick.ts instanceof Date ? tick.ts.getTime() : Date.now();

    s.prices.push(price);
    if (s.position !== 0) s.ticksInPosition++;
    s.ticksSinceLastBuy++;

    if (
      this.risk.cooldownMs > 0 &&
      s.lastTradeAt > 0 &&
      now - s.lastTradeAt < this.risk.cooldownMs
    ) {
      return null;
    }

    const signal = this.evaluate(tick);

    if (signal) {
      // Risk limit checks
      if (signal.side === "BUY") {
        const newPosition = s.position + signal.quantity;
        if (newPosition > this.risk.maxPositionSize) return null;
        if (signal.quantity * price > this.risk.maxNotionalUsd) return null;
      }
      if (signal.side === "SELL" && s.position <= 0) return null;

      signal.entryPrice = s.avgEntryPrice;
      s.lastTradeAt = now;
      if (signal.side === "BUY") {
        const totalCost =
          s.avgEntryPrice * s.position + price * signal.quantity;
        s.position += signal.quantity;
        s.avgEntryPrice = s.position > 0 ? totalCost / s.position : 0;
        s.ticksInPosition = 0;
        s.ticksSinceLastBuy = 0;
      } else {
        s.position = Math.max(0, s.position - signal.quantity);
        if (s.position === 0) s.avgEntryPrice = 0;
      }
    }

    return signal;
  }

  private evaluate(tick: MarketTick): Signal | null {
    switch (this.strategy.algorithm) {
      case "momentum":
        return this.evalMomentum(tick);
      case "mean_reversion":
        return this.evalMeanReversion(tick);
      case "grid":
        return this.evalGrid(tick);
      case "breakout":
        return this.evalBreakout(tick);
      case "dca":
        return this.evalDca(tick);
      default:
        return null;
    }
  }

  // --- momentum: SMA crossover with RSI + volume filter ---------------------
  private evalMomentum(tick: MarketTick): Signal | null {
    const p = this.params as ReturnType<typeof momentumParamsSchema.parse>;
    const s = this.state;
    const fast = sma(s.prices, p.fastPeriod);
    const slow = sma(s.prices, p.slowPeriod);
    if (fast === null || slow === null) return null;
    if (tick.volume < p.minVolume) return null;

    const prevPrices = s.prices.slice(0, -1);
    const prevFast = sma(prevPrices, p.fastPeriod);
    const prevSlow = sma(prevPrices, p.slowPeriod);
    if (prevFast === null || prevSlow === null) return null;

    const cross: -1 | 0 | 1 =
      prevFast <= prevSlow && fast > slow
        ? 1
        : prevFast >= prevSlow && fast < slow
          ? -1
          : 0;
    if (cross === 0 || cross === s.lastCross) return null;

    const r = rsi(s.prices, p.rsiPeriod);

    if (cross === 1 && (r === null || r < p.rsiOverbought)) {
      s.lastCross = 1;
      return {
        side: "BUY",
        entryPrice: 0,
        quantity: p.orderSize,
        reason: `momentum: fast SMA(${p.fastPeriod}) crossed above slow SMA(${p.slowPeriod})${r !== null ? `, RSI=${r.toFixed(1)}` : ""}`,
      };
    }
    if (cross === -1 && (r === null || r > p.rsiOversold)) {
      s.lastCross = -1;
      const qty = Math.min(p.orderSize, s.position);
      if (qty <= 0) return null;
      return {
        side: "SELL",
        entryPrice: 0,
        quantity: qty,
        reason: `momentum: fast SMA(${p.fastPeriod}) crossed below slow SMA(${p.slowPeriod})${r !== null ? `, RSI=${r.toFixed(1)}` : ""}`,
      };
    }
    return null;
  }

  // --- mean_reversion: Bollinger-style snap-back ----------------------------
  private evalMeanReversion(_tick: MarketTick): Signal | null {
    const p = this.params as ReturnType<typeof meanReversionParamsSchema.parse>;
    const s = this.state;
    const mean = sma(s.prices, p.lookbackPeriod);
    const sd = stdDev(s.prices, p.lookbackPeriod);
    if (mean === null || sd === null) return null;

    const price = s.prices[s.prices.length - 1];

    // Force close on max hold
    if (s.position > 0 && s.ticksInPosition >= p.maxHoldTicks) {
      return {
        side: "SELL",
        entryPrice: 0,
        quantity: s.position,
        reason: `mean_reversion: maxHoldTicks(${p.maxHoldTicks}) reached, force close`,
      };
    }

    if (price < mean - p.entryStdDev * sd) {
      return {
        side: "BUY",
        entryPrice: 0,
        quantity: p.orderSize,
        reason: `mean_reversion: price ${price.toFixed(2)} < mean ${mean.toFixed(2)} - ${p.entryStdDev}σ`,
      };
    }
    if (price > mean + p.entryStdDev * sd && s.position > 0) {
      return {
        side: "SELL",
        entryPrice: 0,
        quantity: Math.min(p.orderSize, s.position),
        reason: `mean_reversion: price ${price.toFixed(2)} > mean ${mean.toFixed(2)} + ${p.entryStdDev}σ`,
      };
    }
    if (s.position > 0 && Math.abs(price - mean) <= p.exitStdDev * sd) {
      return {
        side: "SELL",
        entryPrice: 0,
        quantity: s.position,
        reason: `mean_reversion: price reverted within ${p.exitStdDev}σ of mean`,
      };
    }
    return null;
  }

  // --- grid: fixed-interval levels -------------------------------------------
  private evalGrid(_tick: MarketTick): Signal | null {
    const p = this.params as ReturnType<typeof gridParamsSchema.parse>;
    const s = this.state;
    const price = s.prices[s.prices.length - 1];

    if (!s.gridLevels) {
      const anchor = price;
      const lower =
        p.lowerPrice > 0 ? p.lowerPrice : anchor * (1 - p.rangePct / 100);
      const upper =
        p.upperPrice > 0 ? p.upperPrice : anchor * (1 + p.rangePct / 100);
      const step = (upper - lower) / (p.gridLevels - 1);
      s.gridLevels = Array.from(
        { length: p.gridLevels },
        (_, i) => lower + i * step,
      );
      s.lastGridIndex = s.gridLevels.findIndex((l) => l > price);
      if (s.lastGridIndex === -1) s.lastGridIndex = p.gridLevels - 1;
      return null;
    }

    const levels = s.gridLevels;
    let idx = levels.findIndex((l) => l > price);
    if (idx === -1) idx = levels.length - 1;

    const prev = s.lastGridIndex ?? idx;
    if (idx === prev) return null;

    const crossed = Math.abs(idx - prev);
    s.lastGridIndex = idx;

    if (idx < prev) {
      // price moved down through `crossed` levels
      return {
        side: "BUY",
        entryPrice: 0,
        quantity: p.orderSize * crossed,
        reason: `grid: crossed down ${crossed} level(s) to ${idx}/${levels.length - 1}`,
      };
    }
    const qty = Math.min(p.orderSize * crossed, s.position);
    if (qty <= 0) return null;
    return {
      side: "SELL",
      entryPrice: 0,
      quantity: qty,
      reason: `grid: crossed up ${crossed} level(s) to ${idx}/${levels.length - 1}`,
    };
  }

  // --- breakout: Donchian channel --------------------------------------------
  private evalBreakout(_tick: MarketTick): Signal | null {
    const p = this.params as ReturnType<typeof breakoutParamsSchema.parse>;
    const s = this.state;
    if (s.prices.length < p.channelPeriod + 1) return null;

    const price = s.prices[s.prices.length - 1];
    const history = s.prices.slice(s.prices.length - p.channelPeriod - 1, -1);
    const high = Math.max(...history);
    const low = Math.min(...history);

    if (price > high) {
      s.consecutiveAbove++;
      s.consecutiveBelow = 0;
    } else if (price < low) {
      s.consecutiveBelow++;
      s.consecutiveAbove = 0;
    } else {
      s.consecutiveAbove = 0;
      s.consecutiveBelow = 0;
    }

    if (s.consecutiveAbove >= p.confirmationTicks) {
      s.consecutiveAbove = 0;
      return {
        side: "BUY",
        entryPrice: 0,
        quantity: p.orderSize,
        reason: `breakout: close above ${p.channelPeriod}-period high ${high.toFixed(2)} for ${p.confirmationTicks} ticks`,
      };
    }
    if (s.consecutiveBelow >= p.confirmationTicks && s.position > 0) {
      s.consecutiveBelow = 0;
      return {
        side: "SELL",
        entryPrice: 0,
        quantity: Math.min(p.orderSize, s.position),
        reason: `breakout: close below ${p.channelPeriod}-period low ${low.toFixed(2)} for ${p.confirmationTicks} ticks`,
      };
    }
    return null;
  }

  // --- dca: interval accumulation with optional take-profit -------------------
  private evalDca(_tick: MarketTick): Signal | null {
    const p = this.params as ReturnType<typeof dcaParamsSchema.parse>;
    const s = this.state;
    const price = s.prices[s.prices.length - 1];

    if (p.takeProfitPct > 0 && s.position > 0 && s.avgEntryPrice > 0) {
      const pnlPct = ((price - s.avgEntryPrice) / s.avgEntryPrice) * 100;
      if (pnlPct >= p.takeProfitPct) {
        return {
          side: "SELL",
          entryPrice: 0,
          quantity: s.position,
          reason: `dca: take-profit hit at +${pnlPct.toFixed(2)}% (target ${p.takeProfitPct}%)`,
        };
      }
    }

    if (s.ticksSinceLastBuy >= p.intervalTicks) {
      return {
        side: "BUY",
        entryPrice: 0,
        quantity: p.orderSize,
        reason: `dca: interval buy (every ${p.intervalTicks} ticks)`,
      };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tick series generation
// ---------------------------------------------------------------------------

export interface SimTick {
  symbol: string;
  price: number;
  volume: number;
  ts: Date;
}

/** Random-walk series used by simulation + backtests. */
export function generateTickSeries(
  symbol: string,
  count: number,
  startPrice: number,
  volatilityPct: number,
  trendPct: number,
): SimTick[] {
  const out: SimTick[] = [];
  let price = startPrice;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const shock = (Math.random() * 2 - 1) * (volatilityPct / 100);
    const drift = trendPct / 100 / count;
    price = Math.max(0.00000001, price * (1 + shock + drift));
    out.push({
      symbol,
      price,
      volume: Math.round((0.5 + Math.random() * 2) * 1000) / 1000,
      ts: new Date(now + i * 1000),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Backtest
// ---------------------------------------------------------------------------

export interface BacktestTradeResult {
  side: TradeSide;
  quantity: number;
  price: number;
  feeUsd: number;
  pnlUsd: number;
  reason: string;
}

export function runBacktest(
  strategy: Strategy,
  series: SimTick[],
): {
  trades: BacktestTradeResult[];
  summary: Omit<BacktestSummary, "tradeIds">;
} {
  const { params, risk } = TradingEngine.resolveParams(strategy);
  const engine = new TradingEngine(strategy, params, risk);

  const results: BacktestTradeResult[] = [];
  const equityCurve: number[] = [];
  let cumPnl = 0;
  let wins = 0;
  let closes = 0;

  for (const t of series) {
    const tick = {
      id: "",
      symbol: t.symbol,
      price: t.price,
      volume: t.volume,
      ts: t.ts,
    } as MarketTick;

    const signal = engine.onTick(tick);
    if (signal) {
      const slip =
        signal.side === "BUY"
          ? 1 + risk.slippageBps / 10_000
          : 1 - risk.slippageBps / 10_000;
      const execPrice = t.price * slip;
      const fee = (signal.quantity * execPrice * risk.feeBps) / 10_000;
      let pnl = 0;
      if (signal.side === "SELL") {
        pnl = signal.quantity * (execPrice - signal.entryPrice) - fee;
        cumPnl += pnl;
        closes++;
        if (pnl > 0) wins++;
      } else {
        cumPnl -= fee;
      }
      results.push({
        side: signal.side,
        quantity: signal.quantity,
        price: execPrice,
        feeUsd: fee,
        pnlUsd: pnl,
        reason: signal.reason,
      });
    }

    // mark-to-market equity
    equityCurve.push(cumPnl + engine.position * t.price);
  }

  const buys = results.filter((r) => r.side === "BUY").length;
  const sells = results.length - buys;
  const totalFees = results.reduce((a, r) => a + r.feeUsd, 0);

  let peak = equityCurve[0] ?? 0;
  let maxDrawdown = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push(equityCurve[i] - equityCurve[i - 1]);
  }
  const meanRet =
    returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : 0;
  const varRet =
    returns.length > 1
      ? returns.reduce((a, b) => a + (b - meanRet) * (b - meanRet), 0) /
        (returns.length - 1)
      : 0;
  const stdRet = Math.sqrt(varRet);
  const sharpe =
    stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(returns.length) : 0;

  return {
    trades: results,
    summary: {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      ticks: series.length,
      totalTrades: results.length,
      buys,
      sells,
      winRate: closes > 0 ? wins / closes : 0,
      totalPnlUsd: cumPnl,
      totalFeesUsd: totalFees,
      maxDrawdownUsd: maxDrawdown,
      sharpe,
      finalPosition: engine.position,
    },
  };
}

// ---------------------------------------------------------------------------
// Trade execution helper — turns a signal into a Trade record payload
// ---------------------------------------------------------------------------

export function buildTradeRecord(
  strategy: Strategy,
  signal: Signal,
  tick: MarketTick,
  risk: RiskLimits,
  mode: TradeMode,
): Omit<Trade, "id" | "executedAt"> {
  const slip =
    signal.side === "BUY"
      ? 1 + risk.slippageBps / 10_000
      : 1 - risk.slippageBps / 10_000;
  const execPrice = tick.price * slip;
  const notional = signal.quantity * execPrice;
  const fee = (notional * risk.feeBps) / 10_000;
  const pnl =
    signal.side === "SELL"
      ? signal.quantity * (execPrice - signal.entryPrice) - fee
      : 0;

  return {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    side: signal.side,
    quantity: signal.quantity,
    price: execPrice,
    notionalUsd: notional,
    feeUsd: fee,
    pnlUsd: pnl,
    mode,
    signal: signal.reason,
  };
}

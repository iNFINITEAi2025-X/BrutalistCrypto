export interface Candle { t: number; price: number }
export interface Trade { t: number; side: "BUY" | "SELL"; price: number; qty: number; pnl?: number }
export interface Portfolio { cash: number; qty: number }

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export type Signal = "BUY" | "SELL" | null;

/** Moving-average crossover signal at index i (fast crossing slow). */
export function crossoverSignal(fast: (number | null)[], slow: (number | null)[], i: number): Signal {
  if (i < 1) return null;
  const f0 = fast[i - 1], s0 = slow[i - 1], f1 = fast[i], s1 = slow[i];
  if (f0 == null || s0 == null || f1 == null || s1 == null) return null;
  if (f0 <= s0 && f1 > s1) return "BUY";
  if (f0 >= s0 && f1 < s1) return "SELL";
  return null;
}

export interface BacktestResult {
  trades: Trade[];
  finalEquity: number;
  returnPct: number;
  buyHoldPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  equity: number[];
}

export function backtest(
  candles: Candle[],
  opts: { fast: number; slow: number; startingCash: number; feePct: number },
): BacktestResult {
  const { fast, slow, startingCash, feePct } = opts;
  if (!(fast >= 1) || !(slow > fast)) throw new Error("slow period must be greater than fast period");
  if (!(startingCash > 0)) throw new Error("startingCash must be positive");
  if (feePct < 0 || feePct >= 100) throw new Error("feePct must be between 0 and 100");
  if (candles.length < slow + 1) throw new Error(`need at least ${slow + 1} candles`);

  const prices = candles.map((c) => c.price);
  const f = sma(prices, fast), s = sma(prices, slow);
  const pf: Portfolio = { cash: startingCash, qty: 0 };
  const trades: Trade[] = [];
  const equity: number[] = [];
  let entryCost = 0, wins = 0, closed = 0, peak = startingCash, maxDd = 0;

  for (let i = 0; i < candles.length; i++) {
    const p = prices[i];
    const sig = crossoverSignal(f, s, i);
    if (sig === "BUY" && pf.cash > 0) {
      const qty = (pf.cash * (1 - feePct / 100)) / p;
      entryCost = pf.cash;
      trades.push({ t: candles[i].t, side: "BUY", price: p, qty });
      pf.qty = qty; pf.cash = 0;
    } else if (sig === "SELL" && pf.qty > 0) {
      const proceeds = pf.qty * p * (1 - feePct / 100);
      const pnl = proceeds - entryCost;
      trades.push({ t: candles[i].t, side: "SELL", price: p, qty: pf.qty, pnl });
      closed++; if (pnl > 0) wins++;
      pf.cash = proceeds; pf.qty = 0;
    }
    const eq = pf.cash + pf.qty * p;
    equity.push(eq);
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, ((peak - eq) / peak) * 100);
  }
  const finalEquity = equity[equity.length - 1];
  return {
    trades, equity, finalEquity,
    returnPct: ((finalEquity - startingCash) / startingCash) * 100,
    buyHoldPct: ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100,
    maxDrawdownPct: maxDd,
    winRatePct: closed ? (wins / closed) * 100 : 0,
  };
}

/** Deterministic simulated price series (seeded random walk). */
export function simulateCandles(n: number, seed = 1, start = 100): Candle[] {
  let x = seed >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const out: Candle[] = [];
  let p = start;
  const t0 = 1700000000000;
  for (let i = 0; i < n; i++) {
    p = Math.max(1, p * (1 + (rnd() - 0.5) * 0.04));
    out.push({ t: t0 + i * 60000, price: p });
  }
  return out;
}

export class PaperTrader {
  running = false;
  prices: number[] = [];
  candles: Candle[] = [];
  trades: Trade[] = [];
  pf: Portfolio;
  private entryCost = 0;
  private timer: NodeJS.Timeout | null = null;
  private seed = Date.now();
  private last = 100;

  constructor(public fast = 5, public slow = 20, public startingCash = 10000, public feePct = 0.1, public tickMs = 1000) {
    this.pf = { cash: startingCash, qty: 0 };
  }

  configure(fast: number, slow: number, startingCash: number, feePct: number) {
    if (this.running) throw new Error("stop the trader before changing settings");
    if (!(fast >= 1) || !(slow > fast)) throw new Error("slow period must be greater than fast period");
    if (!(startingCash > 0)) throw new Error("startingCash must be positive");
    if (feePct < 0 || feePct >= 100) throw new Error("feePct must be between 0 and 100");
    Object.assign(this, { fast, slow, startingCash, feePct });
    this.reset();
  }

  reset() {
    this.candles = []; this.trades = []; this.entryCost = 0; this.last = 100;
    this.pf = { cash: this.startingCash, qty: 0 };
  }

  tick(price?: number) {
    if (price === undefined) {
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      price = Math.max(1, this.last * (1 + (this.seed / 4294967296 - 0.5) * 0.02));
    }
    this.last = price;
    this.candles.push({ t: Date.now(), price });
    if (this.candles.length > 500) this.candles.shift();
    const p = this.candles.map((c) => c.price);
    const f = sma(p, this.fast), s = sma(p, this.slow);
    const sig = crossoverSignal(f, s, p.length - 1);
    const fee = 1 - this.feePct / 100;
    if (sig === "BUY" && this.pf.cash > 0) {
      const qty = (this.pf.cash * fee) / price;
      this.entryCost = this.pf.cash;
      this.trades.push({ t: Date.now(), side: "BUY", price, qty });
      this.pf = { cash: 0, qty };
    } else if (sig === "SELL" && this.pf.qty > 0) {
      const proceeds = this.pf.qty * price * fee;
      this.trades.push({ t: Date.now(), side: "SELL", price, qty: this.pf.qty, pnl: proceeds - this.entryCost });
      this.pf = { cash: proceeds, qty: 0 };
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  state() {
    const price = this.candles.length ? this.candles[this.candles.length - 1].price : this.last;
    return {
      running: this.running, simulated: true, fast: this.fast, slow: this.slow,
      startingCash: this.startingCash, feePct: this.feePct,
      price, cash: this.pf.cash, qty: this.pf.qty,
      equity: this.pf.cash + this.pf.qty * price,
      trades: this.trades.slice(-50), candles: this.candles.slice(-200),
    };
  }
}

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

async function api(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "request failed");
  return data;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function Trade() {
  const [fast, setFast] = useState(5);
  const [slow, setSlow] = useState(20);
  const [cash, setCash] = useState(10000);
  const [fee, setFee] = useState(0.1);

  const state = useQuery({ queryKey: ["paper"], queryFn: () => api("/api/paper"), refetchInterval: 1000 });
  const act = useMutation({
    mutationFn: (p: { path: string; body?: unknown }) => api(p.path, p.body ?? {}),
    onSuccess: () => state.refetch(),
  });
  const bt = useMutation({
    mutationFn: () => api("/api/backtest", { fast, slow, startingCash: cash, feePct: fee, candles: 1000, seed: Math.floor(Math.random() * 1e6) }),
  });

  const s = state.data;
  const error = (act.error || bt.error) as Error | null;
  const input = "bg-black border border-border px-2 py-1 w-24 font-mono";

  return (
    <main className="min-h-screen bg-background text-foreground p-6 font-mono max-w-5xl mx-auto space-y-8">
      <Link href="/"><span className="underline cursor-pointer">← Home</span></Link>
      <h1 className="font-display text-4xl uppercase font-bold">Paper Trading</h1>
      <p className="text-muted-foreground border-l-2 border-primary pl-4">
        SIMULATED prices and SIMULATED money. Nothing here connects to an exchange or can lose or make real money.
        Strategy: moving-average crossover.
      </p>

      <section className="flex flex-wrap gap-4 items-end">
        <label>Fast MA<br /><input className={input} type="number" value={fast} onChange={(e) => setFast(+e.target.value)} /></label>
        <label>Slow MA<br /><input className={input} type="number" value={slow} onChange={(e) => setSlow(+e.target.value)} /></label>
        <label>Cash<br /><input className={input} type="number" value={cash} onChange={(e) => setCash(+e.target.value)} /></label>
        <label>Fee %<br /><input className={input} type="number" step="0.01" value={fee} onChange={(e) => setFee(+e.target.value)} /></label>
        <button className="brutal-btn" onClick={() => act.mutate({ path: "/api/paper/settings", body: { fast, slow, startingCash: cash, feePct: fee } })}>Apply</button>
        <button className="brutal-btn" data-testid="button-bt" onClick={() => bt.mutate()}>Run Backtest</button>
      </section>

      {error && <div className="border border-red-500 text-red-400 p-3">{error.message}</div>}

      <section className="space-y-4">
        <div className="flex gap-4 items-center">
          {s?.running ? (
            <button className="brutal-btn" data-testid="button-stop" onClick={() => act.mutate({ path: "/api/paper/stop" })}>Stop</button>
          ) : (
            <button className="brutal-btn" data-testid="button-start" onClick={() => act.mutate({ path: "/api/paper/start" })}>Start</button>
          )}
          <button className="px-4 py-2 border border-border" onClick={() => act.mutate({ path: "/api/paper/reset" })}>Reset</button>
          <span>{s?.running ? "RUNNING (simulated)" : "STOPPED"}</span>
        </div>
        {s && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="border border-border p-3">Price<br />{fmt(s.price)}</div>
            <div className="border border-border p-3">Cash<br />{fmt(s.cash)}</div>
            <div className="border border-border p-3">Position<br />{s.qty.toFixed(4)}</div>
            <div className="border border-border p-3">Equity<br />{fmt(s.equity)}</div>
          </div>
        )}
        <div className="h-64 border border-border">
          <ResponsiveContainer>
            <LineChart data={s?.candles ?? []}>
              <XAxis hide dataKey="t" />
              <YAxis domain={["auto", "auto"]} width={50} />
              <Tooltip />
              <Line type="monotone" dataKey="price" dot={false} stroke="#bfff00" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Side</th><th>Price</th><th>Qty</th><th>P&amp;L</th></tr></thead>
          <tbody>
            {(s?.trades ?? []).slice().reverse().map((t: any, i: number) => (
              <tr key={i}><td>{t.side}</td><td>{fmt(t.price)}</td><td>{t.qty.toFixed(4)}</td><td>{t.pnl === undefined ? "-" : fmt(t.pnl)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      {bt.data && (
        <section className="space-y-2 border border-border p-4" data-testid="backtest-result">
          <h2 className="font-display text-2xl uppercase">Backtest (simulated data)</h2>
          <p>Trades: {bt.data.trades.length} · Strategy return: {bt.data.returnPct.toFixed(2)}% · Buy &amp; hold: {bt.data.buyHoldPct.toFixed(2)}% · Max drawdown: {bt.data.maxDrawdownPct.toFixed(2)}% · Win rate: {bt.data.winRatePct.toFixed(0)}%</p>
          <p className="text-muted-foreground">Results on simulated data say nothing about real-market profit.</p>
        </section>
      )}
    </main>
  );
}

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  FlaskConical,
  Play,
  Plus,
  Send,
  Square,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ALGORITHMS,
  WEBHOOK_EVENTS,
  defaultParamsForAlgorithm,
  type AlgorithmType,
  type BacktestSummary,
  type Strategy,
  type Trade,
  type Webhook,
  type WebhookDelivery,
} from "@shared/schema";

// ---------------------------------------------------------------------------

const ALGO_PARAM_KEYS: Record<AlgorithmType, string[]> = {
  momentum: [
    "fastPeriod",
    "slowPeriod",
    "rsiPeriod",
    "rsiOverbought",
    "rsiOversold",
    "minVolume",
    "orderSize",
  ],
  mean_reversion: [
    "lookbackPeriod",
    "entryStdDev",
    "exitStdDev",
    "maxHoldTicks",
    "orderSize",
  ],
  grid: ["gridLevels", "lowerPrice", "upperPrice", "rangePct", "orderSize"],
  breakout: ["channelPeriod", "confirmationTicks", "orderSize"],
  dca: ["intervalTicks", "orderSize", "takeProfitPct"],
};

const RISK_KEYS = [
  "maxPositionSize",
  "maxNotionalUsd",
  "feeBps",
  "slippageBps",
  "cooldownMs",
] as const;

const DEFAULT_RISK: Record<(typeof RISK_KEYS)[number], number> = {
  maxPositionSize: 10,
  maxNotionalUsd: 100000,
  feeBps: 10,
  slippageBps: 5,
  cooldownMs: 0,
};

const fmtUsd = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 6 });

// ---------------------------------------------------------------------------

export default function TradesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1 pt-24 pb-16 max-w-7xl mx-auto px-6 w-full">
        <div className="mb-10">
          <div className="inline-block border border-primary px-3 py-1 font-mono text-xs text-primary tracking-widest uppercase mb-4 bg-primary/10">
            Engine Console
          </div>
          <h1 className="font-display text-5xl md:text-6xl font-bold uppercase tracking-tighter">
            Trades<span className="text-primary">_</span>Logic
          </h1>
          <p className="font-mono text-muted-foreground mt-4 max-w-2xl border-l-2 border-primary pl-4 text-sm">
            Strategy engine, immutable trades log, backtesting and signed
            webhook notifications. See readme.md for the full spec.
          </p>
        </div>

        <StatsBar />

        <Tabs defaultValue="trades" className="mt-8">
          <TabsList className="border border-border bg-card">
            <TabsTrigger value="trades" className="font-mono uppercase text-xs">
              Trades Log
            </TabsTrigger>
            <TabsTrigger
              value="strategies"
              className="font-mono uppercase text-xs"
            >
              Strategies
            </TabsTrigger>
            <TabsTrigger
              value="webhooks"
              className="font-mono uppercase text-xs"
            >
              Webhooks
            </TabsTrigger>
            <TabsTrigger
              value="backtest"
              className="font-mono uppercase text-xs"
            >
              Backtest
            </TabsTrigger>
          </TabsList>
          <TabsContent value="trades">
            <TradesTab />
          </TabsContent>
          <TabsContent value="strategies">
            <StrategiesTab />
          </TabsContent>
          <TabsContent value="webhooks">
            <WebhooksTab />
          </TabsContent>
          <TabsContent value="backtest">
            <BacktestTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Navbar() {
  return (
    <nav className="fixed top-0 left-0 w-full z-50 border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="flex items-center justify-between h-16 px-6 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-primary animate-pulse" />
          <Link href="/">
            <a className="font-display font-bold text-2xl tracking-tighter hover:opacity-80 transition-opacity cursor-pointer">
              NEXUS<span className="text-primary">//</span>TRADE
            </a>
          </Link>
          <span className="ml-4 px-2 py-0.5 border border-border text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Engine v1.0
          </span>
        </div>
        <Link href="/">
          <a className="flex items-center gap-2 hover:text-primary uppercase tracking-widest text-xs font-mono">
            <ArrowLeft className="w-3 h-3" /> Home
          </a>
        </Link>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------

interface Stats {
  totalTrades: number;
  buys: number;
  sells: number;
  winRate: number;
  totalPnlUsd: number;
  totalFeesUsd: number;
  totalVolumeUsd: number;
}

function StatsBar() {
  const { data } = useQuery<Stats>({
    queryKey: ["/api/trades/stats"],
    refetchInterval: 3000,
  });
  const items: [string, string][] = [
    ["TRADES", String(data?.totalTrades ?? 0)],
    ["WIN RATE", `${(((data?.winRate ?? 0) * 100)).toFixed(1)}%`],
    ["PNL", fmtUsd(data?.totalPnlUsd ?? 0)],
    ["FEES", fmtUsd(data?.totalFeesUsd ?? 0)],
    ["VOLUME", fmtUsd(data?.totalVolumeUsd ?? 0)],
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border border border-border">
      {items.map(([k, v]) => (
        <div key={k} className="bg-background p-4">
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
            {k}
          </div>
          <div
            className={`font-display text-2xl font-bold mt-1 ${
              k === "PNL" && (data?.totalPnlUsd ?? 0) < 0
                ? "text-destructive"
                : "text-primary"
            }`}
          >
            {v}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TradesTab() {
  const [strategyFilter, setStrategyFilter] = useState<string>("all");
  const { data: strategies } = useQuery<Strategy[]>({
    queryKey: ["/api/strategies"],
  });
  const url =
    strategyFilter === "all"
      ? "/api/trades?limit=200"
      : `/api/trades?strategyId=${strategyFilter}&limit=200`;
  const { data: trades, isLoading } = useQuery<Trade[]>({
    queryKey: [url],
    refetchInterval: 3000,
  });

  return (
    <div className="border border-border bg-card mt-4">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          <Activity className="w-4 h-4 text-primary" /> Immutable execution log
        </div>
        <Select value={strategyFilter} onValueChange={setStrategyFilter}>
          <SelectTrigger className="w-56 font-mono text-xs">
            <SelectValue placeholder="Filter by strategy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ALL STRATEGIES</SelectItem>
            {(strategies ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="font-mono text-xs uppercase">
            <TableHead>Time</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Side</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Notional</TableHead>
            <TableHead className="text-right">Fee</TableHead>
            <TableHead className="text-right">PnL</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Signal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={10} className="font-mono text-xs">
                LOADING…
              </TableCell>
            </TableRow>
          )}
          {!isLoading && (trades ?? []).length === 0 && (
            <TableRow>
              <TableCell
                colSpan={10}
                className="font-mono text-xs text-muted-foreground"
              >
                NO TRADES YET — create a strategy, start it, then simulate
                ticks.
              </TableCell>
            </TableRow>
          )}
          {(trades ?? []).map((t) => (
            <TableRow key={t.id} className="font-mono text-xs">
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {new Date(t.executedAt).toLocaleTimeString()}
              </TableCell>
              <TableCell>{t.symbol}</TableCell>
              <TableCell>
                <Badge
                  variant={t.side === "BUY" ? "default" : "destructive"}
                  className="font-mono text-[10px]"
                >
                  {t.side}
                </Badge>
              </TableCell>
              <TableCell className="text-right">{fmtNum(t.quantity)}</TableCell>
              <TableCell className="text-right">{fmtUsd(t.price)}</TableCell>
              <TableCell className="text-right">
                {fmtUsd(t.notionalUsd)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {fmtUsd(t.feeUsd)}
              </TableCell>
              <TableCell
                className={`text-right ${
                  t.pnlUsd < 0
                    ? "text-destructive"
                    : t.pnlUsd > 0
                      ? "text-primary"
                      : "text-muted-foreground"
                }`}
              >
                {fmtUsd(t.pnlUsd)}
              </TableCell>
              <TableCell className="uppercase text-[10px]">{t.mode}</TableCell>
              <TableCell
                className="max-w-64 truncate text-muted-foreground"
                title={t.signal}
              >
                {t.signal}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StrategiesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: strategies, isLoading } = useQuery<Strategy[]>({
    queryKey: ["/api/strategies"],
    refetchInterval: 3000,
  });

  const [name, setName] = useState("ALPHA-01");
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [algorithm, setAlgorithm] = useState<AlgorithmType>("momentum");
  const [params, setParams] = useState<Record<string, number>>({
    ...defaultParamsForAlgorithm.momentum,
  });
  const [risk, setRisk] = useState<Record<string, number>>({ ...DEFAULT_RISK });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/strategies"] });
    qc.invalidateQueries({ queryKey: ["/api/trades/stats"] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/strategies", {
        name,
        symbol,
        algorithm,
        params,
        riskLimits: risk,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Strategy created" });
      invalidate();
    },
    onError: (e) =>
      toast({
        title: "Create failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const action = useMutation({
    mutationFn: async ({
      id,
      verb,
    }: {
      id: string;
      verb: "start" | "stop" | "delete";
    }) => {
      if (verb === "delete") return apiRequest("DELETE", `/api/strategies/${id}`);
      return apiRequest("POST", `/api/strategies/${id}/${verb}`);
    },
    onSuccess: (_d, v) => {
      toast({ title: `Strategy ${v.verb} ok` });
      invalidate();
    },
    onError: (e) =>
      toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const simulate = useMutation({
    mutationFn: async (sym: string) => {
      const res = await apiRequest("POST", "/api/market/simulate", {
        symbol: sym,
        ticks: 200,
        startPrice: 50000,
        volatilityPct: 1.5,
        trendPct: 0,
      });
      return res.json();
    },
    onSuccess: (d) => {
      toast({
        title: "Simulation complete",
        description: `${d.ticksIngested} ticks, ${d.signalsFired} signal(s) fired`,
      });
      invalidate();
      qc.invalidateQueries();
    },
    onError: (e) =>
      toast({ title: "Simulate failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border mt-4">
      {/* Create form */}
      <div className="bg-background p-6 space-y-4">
        <h3 className="font-display text-xl font-bold uppercase flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" /> New Strategy
        </h3>
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase">Symbol</Label>
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase">Algorithm</Label>
          <Select
            value={algorithm}
            onValueChange={(v) => {
              const algo = v as AlgorithmType;
              setAlgorithm(algo);
              setParams({ ...defaultParamsForAlgorithm[algo] });
            }}
          >
            <SelectTrigger className="font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALGORITHMS.map((a) => (
                <SelectItem key={a} value={a} className="font-mono text-xs">
                  {a.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="pt-2 border-t border-border">
          <div className="font-mono text-[10px] text-primary uppercase tracking-widest mb-2">
            Algorithm params
          </div>
          <div className="grid grid-cols-2 gap-2">
            {ALGO_PARAM_KEYS[algorithm].map((k) => (
              <div key={k} className="space-y-1">
                <Label className="font-mono text-[10px]">{k}</Label>
                <Input
                  type="number"
                  value={params[k] ?? 0}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, [k]: Number(e.target.value) }))
                  }
                  className="font-mono text-xs h-8"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-border">
          <div className="font-mono text-[10px] text-primary uppercase tracking-widest mb-2">
            Risk limits
          </div>
          <div className="grid grid-cols-2 gap-2">
            {RISK_KEYS.map((k) => (
              <div key={k} className="space-y-1">
                <Label className="font-mono text-[10px]">{k}</Label>
                <Input
                  type="number"
                  value={risk[k] ?? 0}
                  onChange={(e) =>
                    setRisk((r) => ({ ...r, [k]: Number(e.target.value) }))
                  }
                  className="font-mono text-xs h-8"
                />
              </div>
            ))}
          </div>
        </div>

        <Button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="brutal-btn w-full"
        >
          Deploy Strategy
        </Button>
      </div>

      {/* Strategy list */}
      <div className="bg-background p-6 lg:col-span-2">
        <h3 className="font-display text-xl font-bold uppercase mb-4">
          Deployed ({(strategies ?? []).length})
        </h3>
        {isLoading && (
          <div className="font-mono text-xs text-muted-foreground">
            LOADING…
          </div>
        )}
        <div className="space-y-3">
          {(strategies ?? []).map((s) => (
            <div key={s.id} className="border border-border p-4 bg-card">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 ${
                        s.status === "running"
                          ? "bg-primary animate-pulse"
                          : "bg-muted-foreground"
                      }`}
                    />
                    <span className="font-display font-bold">{s.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {s.algorithm.toUpperCase()}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.symbol}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground mt-2">
                    {Object.entries(s.params as Record<string, number>)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {s.status === "running" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        action.mutate({ id: s.id, verb: "stop" })
                      }
                      className="font-mono text-xs"
                    >
                      <Square className="w-3 h-3 mr-1" /> STOP
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() =>
                        action.mutate({ id: s.id, verb: "start" })
                      }
                      className="font-mono text-xs"
                    >
                      <Play className="w-3 h-3 mr-1" /> START
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => simulate.mutate(s.symbol)}
                    className="font-mono text-xs"
                  >
                    <Send className="w-3 h-3 mr-1" /> SIM TICKS
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      action.mutate({ id: s.id, verb: "delete" })
                    }
                    className="font-mono text-xs"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!isLoading && (strategies ?? []).length === 0 && (
            <div className="font-mono text-xs text-muted-foreground">
              NO STRATEGIES DEPLOYED.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function WebhooksTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: webhooks, isLoading } = useQuery<Webhook[]>({
    queryKey: ["/api/webhooks"],
    refetchInterval: 4000,
  });
  const { data: deliveries } = useQuery<WebhookDelivery[]>({
    queryKey: ["/api/webhooks-deliveries-all"],
    queryFn: async () => {
      const hooks: Webhook[] = await (await fetch("/api/webhooks")).json();
      const all: WebhookDelivery[] = [];
      for (const h of hooks) {
        const d: WebhookDelivery[] = await (
          await fetch(`/api/webhooks/${h.id}/deliveries`)
        ).json();
        all.push(...d);
      }
      return all
        .sort(
          (a, b) =>
            new Date(b.deliveredAt).getTime() -
            new Date(a.deliveredAt).getTime(),
        )
        .slice(0, 50);
    },
    refetchInterval: 4000,
  });

  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>(["trade.executed"]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/webhooks"] });
    qc.invalidateQueries({ queryKey: ["/api/webhooks-deliveries-all"] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/webhooks", {
        url,
        events,
        ...(secret ? { secret } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Webhook registered" });
      setUrl("");
      invalidate();
    },
    onError: (e) =>
      toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (h: Webhook) =>
      apiRequest("PATCH", `/api/webhooks/${h.id}`, { active: !h.active }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/webhooks/${id}`),
    onSuccess: () => {
      toast({ title: "Webhook deleted" });
      invalidate();
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/webhooks/${id}/test`);
      return res.json();
    },
    onSuccess: (d) => {
      toast({
        title: "Test ping sent",
        description: d?.delivery?.status
          ? `Delivery ${d.delivery.status}`
          : undefined,
      });
      invalidate();
    },
    onError: (e) =>
      toast({ title: "Ping failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border mt-4">
      <div className="bg-background p-6 space-y-4">
        <h3 className="font-display text-xl font-bold uppercase flex items-center gap-2">
          <WebhookIcon className="w-4 h-4 text-primary" /> New Webhook
        </h3>
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase">Endpoint URL</Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hook"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase">
            Secret (optional, for HMAC)
          </Label>
          <Input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="auto-generated if empty"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase">Events</Label>
          {WEBHOOK_EVENTS.map((ev) => (
            <label
              key={ev}
              className="flex items-center gap-2 font-mono text-xs"
            >
              <input
                type="checkbox"
                checked={events.includes(ev)}
                onChange={(e) =>
                  setEvents((cur) =>
                    e.target.checked
                      ? [...cur, ev]
                      : cur.filter((x) => x !== ev),
                  )
                }
              />
              {ev}
            </label>
          ))}
        </div>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !url || events.length === 0}
          className="brutal-btn w-full"
        >
          Register Webhook
        </Button>
        <p className="font-mono text-[10px] text-muted-foreground">
          Payloads are signed: X-Nexus-Signature = sha256=HMAC(secret, body).
        </p>
      </div>

      <div className="bg-background p-6 lg:col-span-2 space-y-6">
        <div>
          <h3 className="font-display text-xl font-bold uppercase mb-4">
            Registered ({(webhooks ?? []).length})
          </h3>
          {isLoading && (
            <div className="font-mono text-xs text-muted-foreground">
              LOADING…
            </div>
          )}
          <div className="space-y-3">
            {(webhooks ?? []).map((h) => (
              <div key={h.id} className="border border-border p-4 bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs truncate">{h.url}</div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-1">
                      {(h.events as string[]).join(" · ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={h.active}
                        onCheckedChange={() => toggleMutation.mutate(h)}
                      />
                      <span className="font-mono text-[10px] uppercase">
                        {h.active ? "active" : "off"}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => testMutation.mutate(h.id)}
                      className="font-mono text-xs"
                    >
                      PING
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(h.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {!isLoading && (webhooks ?? []).length === 0 && (
              <div className="font-mono text-xs text-muted-foreground">
                NO WEBHOOKS REGISTERED.
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="font-display text-xl font-bold uppercase mb-4">
            Delivery Log
          </h3>
          <div className="border border-border">
            <Table>
              <TableHeader>
                <TableRow className="font-mono text-xs uppercase">
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">HTTP</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(deliveries ?? []).map((d) => (
                  <TableRow key={d.id} className="font-mono text-xs">
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {new Date(d.deliveredAt).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>{d.event}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === "success" ? "default" : "destructive"
                        }
                        className="font-mono text-[10px]"
                      >
                        {d.status.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {d.httpStatus ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{d.attempts}</TableCell>
                    <TableCell className="text-right">
                      {d.latencyMs != null ? `${d.latencyMs}ms` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(deliveries ?? []).length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      NO DELIVERIES YET.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BacktestTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: strategies } = useQuery<Strategy[]>({
    queryKey: ["/api/strategies"],
  });
  const [strategyId, setStrategyId] = useState("");
  const [ticks, setTicks] = useState(500);
  const [startPrice, setStartPrice] = useState(50000);
  const [volatilityPct, setVolatilityPct] = useState(1.5);
  const [trendPct, setTrendPct] = useState(0);
  const [result, setResult] = useState<BacktestSummary | null>(null);

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/backtests", {
        strategyId,
        ticks,
        startPrice,
        volatilityPct,
        trendPct,
      });
      return res.json();
    },
    onSuccess: (d) => {
      setResult(d);
      toast({ title: "Backtest complete" });
      qc.invalidateQueries({ queryKey: ["/api/trades/stats"] });
      qc.invalidateQueries();
    },
    onError: (e) =>
      toast({ title: "Backtest failed", description: e.message, variant: "destructive" }),
  });

  const rows: [string, string][] = useMemo(() => {
    if (!result) return [];
    return [
      ["SYMBOL", result.symbol],
      ["TICKS", String(result.ticks)],
      ["TRADES", `${result.totalTrades} (${result.buys}B / ${result.sells}S)`],
      ["WIN RATE", `${(result.winRate * 100).toFixed(1)}%`],
      ["TOTAL PNL", fmtUsd(result.totalPnlUsd)],
      ["FEES", fmtUsd(result.totalFeesUsd)],
      ["MAX DRAWDOWN", fmtUsd(result.maxDrawdownUsd)],
      ["SHARPE", result.sharpe.toFixed(3)],
      ["FINAL POSITION", fmtNum(result.finalPosition)],
    ];
  }, [result]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border mt-4">
      <div className="bg-background p-6 space-y-4">
        <h3 className="font-display text-xl font-bold uppercase flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary" /> Run Backtest
        </h3>
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase">Strategy</Label>
          <Select value={strategyId} onValueChange={setStrategyId}>
            <SelectTrigger className="font-mono text-xs">
              <SelectValue placeholder="Select strategy" />
            </SelectTrigger>
            <SelectContent>
              {(strategies ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id} className="font-mono text-xs">
                  {s.name} ({s.algorithm})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(
          [
            ["Ticks", ticks, setTicks],
            ["Start price", startPrice, setStartPrice],
            ["Volatility %", volatilityPct, setVolatilityPct],
            ["Trend %", trendPct, setTrendPct],
          ] as const
        ).map(([label, value, setter]) => (
          <div key={label} className="space-y-2">
            <Label className="font-mono text-xs uppercase">{label}</Label>
            <Input
              type="number"
              value={value}
              onChange={(e) => setter(Number(e.target.value))}
              className="font-mono text-xs"
            />
          </div>
        ))}
        <Button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending || !strategyId}
          className="brutal-btn w-full"
        >
          {runMutation.isPending ? "RUNNING…" : "RUN BACKTEST"}
        </Button>
      </div>

      <div className="bg-background p-6 lg:col-span-2">
        <h3 className="font-display text-xl font-bold uppercase mb-4">
          Result
        </h3>
        {!result && (
          <div className="font-mono text-xs text-muted-foreground">
            RUN A BACKTEST TO SEE SUMMARY METRICS.
          </div>
        )}
        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border border border-border">
            {rows.map(([k, v]) => (
              <div key={k} className="bg-background p-4">
                <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                  {k}
                </div>
                <div
                  className={`font-display text-xl font-bold mt-1 ${
                    k === "TOTAL PNL"
                      ? result.totalPnlUsd < 0
                        ? "text-destructive"
                        : "text-primary"
                      : ""
                  }`}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

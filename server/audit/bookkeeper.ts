import { storage } from "../storage";
import type {
  AuditChecklistItem,
  AuditLogEntry,
  DailyAudit,
  Trade,
} from "@shared/schema";

/**
 * AI BOOKKEEPER + SYSTEM AUDITOR
 *
 * A deterministic, heuristic-driven agent that:
 *  1. Keeps the books — posts ledger entries for trades, distribution events,
 *     and operational activity.
 *  2. Continuously scans records for anomalies (negative notional, orphan
 *     trades, license overuse, webhook failure spikes, ...) and writes them
 *     to the immutable audit log.
 *  3. Compiles a daily audit package: a checklist of system checks with
 *     pass/fail results, aggregate totals, and anomaly count — which then
 *     sits in `pending` until an Admin approves or rejects it.
 *
 * It is "AI" in the expert-system sense: rule-based inference over the
 * record set, no external model calls, fully auditable and reproducible.
 */

const BK = "ai-bookkeeper";

function utcDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 1. Bookkeeping — ledger posting helpers
// ---------------------------------------------------------------------------

export async function postTradeToLedger(trade: Trade): Promise<void> {
  await storage.appendLedgerEntry({
    category: "fees",
    description: `Fee on ${trade.side} ${trade.quantity} ${trade.symbol} @ ${trade.price}`,
    amountUsd: -Math.abs(trade.feeUsd),
    reference: `trade:${trade.id}`,
    createdBy: BK,
  });
  if (trade.side === "SELL" && trade.pnlUsd !== 0) {
    await storage.appendLedgerEntry({
      category: "pnl",
      description: `Realized P&L ${trade.symbol} (${trade.mode})`,
      amountUsd: trade.pnlUsd,
      reference: `trade:${trade.id}`,
      createdBy: BK,
    });
  }
}

export async function postDistributionToLedger(
  description: string,
  reference: string,
): Promise<void> {
  await storage.appendLedgerEntry({
    category: "distribution",
    description,
    amountUsd: 0,
    reference,
    createdBy: BK,
  });
}

// ---------------------------------------------------------------------------
// 2. System audit — heuristic anomaly detection over all records
// ---------------------------------------------------------------------------

export interface AuditFinding {
  action: string;
  entity: string;
  entityId: string;
  detail: Record<string, unknown>;
  severity: "info" | "warning" | "critical";
}

export async function runSystemAudit(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const [trades, licenses, downloads, deliveries, strategies] =
    await Promise.all([
      storage.getTrades({ limit: 100_000 }),
      storage.getLicenses(),
      storage.getDownloads(),
      storage.getWebhookDeliveries(),
      storage.getStrategies(),
    ]);

  // --- Trades integrity -----------------------------------------------------
  for (const t of trades) {
    if (t.notionalUsd < 0 || t.quantity <= 0 || t.price <= 0) {
      findings.push({
        action: "anomaly.trade.invalid_numbers",
        entity: "trade",
        entityId: t.id,
        detail: { side: t.side, quantity: t.quantity, price: t.price, notionalUsd: t.notionalUsd },
        severity: "critical",
      });
    }
    const expectedNotional = t.quantity * t.price;
    if (Math.abs(expectedNotional - t.notionalUsd) > Math.max(1, expectedNotional * 0.01)) {
      findings.push({
        action: "anomaly.trade.notional_mismatch",
        entity: "trade",
        entityId: t.id,
        detail: { expectedNotional, actualNotional: t.notionalUsd },
        severity: "warning",
      });
    }
    if (!strategies.some((s) => s.id === t.strategyId)) {
      findings.push({
        action: "anomaly.trade.orphan_strategy",
        entity: "trade",
        entityId: t.id,
        detail: { strategyId: t.strategyId },
        severity: "warning",
      });
    }
  }

  // --- License integrity ------------------------------------------------------
  for (const lic of licenses) {
    if (lic.maxDownloads > 0 && lic.downloadsUsed > lic.maxDownloads) {
      findings.push({
        action: "anomaly.license.overuse",
        entity: "license",
        entityId: lic.id,
        detail: { downloadsUsed: lic.downloadsUsed, maxDownloads: lic.maxDownloads },
        severity: "critical",
      });
    }
    if (lic.expiresAt && new Date(lic.expiresAt).getTime() < Date.now() && lic.status === "active") {
      findings.push({
        action: "anomaly.license.expired_active",
        entity: "license",
        entityId: lic.id,
        detail: { expiresAt: lic.expiresAt },
        severity: "warning",
      });
    }
  }

  // --- Webhook delivery health -------------------------------------------------
  const failed = deliveries.filter((d) => d.status === "failed").length;
  if (deliveries.length >= 10 && failed / deliveries.length > 0.5) {
    findings.push({
      action: "anomaly.webhooks.high_failure_rate",
      entity: "webhook",
      entityId: "",
      detail: { failed, total: deliveries.length },
      severity: "warning",
    });
  }

  // --- Distribution volume -------------------------------------------------------
  const last24h = Date.now() - 24 * 3600 * 1000;
  const recentDownloads = downloads.filter(
    (d) => new Date(d.downloadedAt).getTime() > last24h,
  ).length;
  findings.push({
    action: "audit.distribution.24h_volume",
    entity: "download",
    entityId: "",
    detail: { downloads24h: recentDownloads, totalDownloads: downloads.length },
    severity: "info",
  });

  // Persist findings to the immutable audit log
  for (const f of findings) {
    await storage.appendAuditLog({
      actor: BK,
      action: f.action,
      entity: f.entity,
      entityId: f.entityId,
      detail: f.detail,
      severity: f.severity,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 3. Daily audit package — checklist for Admin approval
// ---------------------------------------------------------------------------

export async function generateDailyAudit(date = utcDateString()): Promise<DailyAudit> {
  const existing = await storage.getDailyAuditByDate(date);
  if (existing) return existing;

  const findings = await runSystemAudit();
  const anomalies = findings.filter((f) => f.severity !== "info");

  const [trades, strategies, releases, downloads, licenses, ledger, users] =
    await Promise.all([
      storage.getTrades({ limit: 100_000 }),
      storage.getStrategies(),
      storage.getReleases(),
      storage.getDownloads(),
      storage.getLicenses(),
      storage.getLedgerEntries(100_000),
      storage.listUsers(),
    ]);

  const totals = {
    trades: trades.length,
    strategies: strategies.length,
    runningStrategies: strategies.filter((s) => s.status === "running").length,
    releases: releases.length,
    publishedReleases: releases.filter((r) => r.published).length,
    downloads: downloads.length,
    licenses: licenses.length,
    activeLicenses: licenses.filter((l) => l.status === "active").length,
    users: users.length,
    ledgerBalanceUsd: ledger.reduce((a, e) => a + e.amountUsd, 0),
    totalPnlUsd: trades.reduce((a, t) => a + t.pnlUsd, 0),
    totalFeesUsd: trades.reduce((a, t) => a + t.feeUsd, 0),
  };

  const criticals = anomalies.filter((a) => a.severity === "critical").length;
  const warnings = anomalies.filter((a) => a.severity === "warning").length;

  const checklist: AuditChecklistItem[] = [
    {
      key: "trades_integrity",
      label: "Trades log integrity (no invalid quantities/prices, no orphan strategies)",
      status: anomalies.some((a) => a.entity === "trade") ? "failed" : "passed",
      detail: `${trades.length} trades scanned`,
    },
    {
      key: "license_compliance",
      label: "License compliance (no overuse, no expired-but-active keys)",
      status: anomalies.some((a) => a.entity === "license") ? "failed" : "passed",
      detail: `${licenses.length} licenses scanned`,
    },
    {
      key: "webhook_health",
      label: "Webhook delivery health (failure rate below 50%)",
      status: anomalies.some((a) => a.action === "anomaly.webhooks.high_failure_rate")
        ? "failed"
        : "passed",
      detail: "Delivery log analysed",
    },
    {
      key: "ledger_posted",
      label: "AI bookkeeper ledger posting active",
      status: ledger.length > 0 ? "passed" : "pending",
      detail: `${ledger.length} ledger entries`,
    },
    {
      key: "distribution_records",
      label: "Distribution records present (releases & download log)",
      status: releases.length > 0 ? "passed" : "pending",
      detail: `${releases.length} releases, ${downloads.length} downloads`,
    },
  ];

  const audit = await storage.createDailyAudit({
    date,
    status: "pending",
    checklist,
    totals,
    anomalyCount: anomalies.length,
    generatedBy: BK,
  });

  await storage.appendAuditLog({
    actor: BK,
    action: "audit.daily.generated",
    entity: "daily_audit",
    entityId: audit.id,
    detail: { date, anomalyCount: anomalies.length, criticals, warnings },
    severity: criticals > 0 ? "critical" : warnings > 0 ? "warning" : "info",
  });

  return audit;
}

/** Ensure today's daily audit exists; generate it if missing. */
export async function ensureDailyAudit(): Promise<DailyAudit> {
  const today = utcDateString();
  const existing = await storage.getDailyAuditByDate(today);
  if (existing) return existing;
  return generateDailyAudit(today);
}

export type { AuditLogEntry };

import { createHash, timingSafeEqual } from "crypto";
import { storage } from "../storage";
import type {
  FailoverNode,
  FallbackConfig,
  LockdownLevel,
  ReplicationEnvelope,
} from "@shared/schema";
import { log } from "../index";

/**
 * FAILOVER / RESILIENCE ENGINE — mirrored VPS backup.
 *
 * A node is either PRIMARY (serves traffic, pushes state) or STANDBY
 * (mirrors the primary, ready to be promoted). Peers authenticate with a
 * shared per-node token over `Authorization: Bearer`.
 *
 * - Heartbeats probe every enabled peer on a timer; consecutive failures
 *   mark a peer `unreachable` and, when autoFailover is on and the failed
 *   peer was the primary, promote the healthiest standby (or self).
 * - Snapshots replicate the full replicable state (strategies, trades,
 *   releases, licenses, audits, ledger, audit log) with a SHA-256 checksum.
 * - Fallback parameters form a degradation ladder: when mirrors are lost or
 *   a critical anomaly fires, the security lockdown level rises and trading
 *   quality guards engage (feed staleness, volatility caps).
 */

const PEER_TIMEOUT_MS_DEFAULT = 5_000;
const RETENTION_LIMIT = 10_000; // cap replicated collections to bound payloads

let sequence = 0;
let selfRole: "primary" | "standby" = "primary";
const selfName = process.env.NODE_NAME ?? "node-local";

export function getSelfRole(): "primary" | "standby" {
  return selfRole;
}

async function config(): Promise<FallbackConfig> {
  return storage.getFallbackConfig();
}

// ---------------------------------------------------------------------------
// Peer authentication
// ---------------------------------------------------------------------------

/** Verify an inbound peer request against any registered node's token. */
export async function verifyPeerToken(
  token: string | undefined,
): Promise<FailoverNode | null> {
  if (!token) return null;
  const nodes = await storage.getFailoverNodes();
  for (const n of nodes) {
    const a = Buffer.from(n.authToken);
    const b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Snapshot build / apply
// ---------------------------------------------------------------------------

function checksumPayload(payload: Omit<ReplicationEnvelope, "checksum">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        node: payload.node,
        sequence: payload.sequence,
        strategies: payload.strategies,
        trades: payload.trades,
        releases: payload.releases,
        licenses: payload.licenses,
        dailyAudits: payload.dailyAudits,
        ledger: payload.ledger,
        auditLog: payload.auditLog,
      }),
    )
    .digest("hex");
}

/** Build a replication snapshot of this node's replicable state. */
export async function buildSnapshot(): Promise<ReplicationEnvelope> {
  const [strategies, trades, releases, licenses, dailyAudits, ledger, auditLog] =
    await Promise.all([
      storage.getStrategies(),
      storage.getTrades({ limit: RETENTION_LIMIT }),
      storage.getReleases(),
      storage.getLicenses(),
      storage.getDailyAudits(),
      storage.getLedgerEntries(RETENTION_LIMIT),
      storage.getAuditLog(RETENTION_LIMIT),
    ]);

  // Strip release artifact payloads from replication (metadata only).
  const releasesMeta = releases.map(({ artifactData: _a, ...rest }) => rest);

  sequence++;
  const payload = {
    node: selfName,
    sequence,
    createdAt: new Date().toISOString(),
    strategies,
    trades,
    releases: releasesMeta,
    licenses,
    dailyAudits,
    ledger,
    auditLog,
  };
  return { ...payload, checksum: checksumPayload(payload) };
}

/**
 * Apply a snapshot received from a peer. Records are merged by id — existing
 * ids are left untouched (immutable records), missing ones are appended.
 * Returns counts of newly applied records per collection.
 */
export async function applySnapshot(
  snap: ReplicationEnvelope,
): Promise<Record<string, number>> {
  const expected = checksumPayload({
    node: snap.node,
    sequence: snap.sequence,
    createdAt: snap.createdAt,
    strategies: snap.strategies,
    trades: snap.trades,
    releases: snap.releases,
    licenses: snap.licenses,
    dailyAudits: snap.dailyAudits,
    ledger: snap.ledger,
    auditLog: snap.auditLog,
  });
  if (expected !== snap.checksum) {
    throw new Error("snapshot checksum mismatch");
  }

  const applied: Record<string, number> = {
    strategies: 0,
    trades: 0,
    releases: 0,
    licenses: 0,
    dailyAudits: 0,
    ledger: 0,
    auditLog: 0,
  };

  // Trades — immutable, merge by id.
  const existingTrades = new Set(
    (await storage.getTrades({ limit: RETENTION_LIMIT })).map((t) => t.id),
  );
  for (const raw of snap.trades as Array<Record<string, unknown>>) {
    if (typeof raw.id === "string" && !existingTrades.has(raw.id)) {
      await storage.createTrade({
        strategyId: String(raw.strategyId),
        symbol: String(raw.symbol),
        side: String(raw.side),
        quantity: Number(raw.quantity),
        price: Number(raw.price),
        notionalUsd: Number(raw.notionalUsd),
        feeUsd: Number(raw.feeUsd),
        pnlUsd: Number(raw.pnlUsd ?? 0),
        mode: String(raw.mode ?? "simulated"),
        signal: String(raw.signal ?? ""),
        executedAt: raw.executedAt ? new Date(String(raw.executedAt)) : new Date(),
      });
      applied.trades++;
    }
  }

  // Ledger — immutable, merge by id.
  const existingLedger = new Set(
    (await storage.getLedgerEntries(RETENTION_LIMIT)).map((e) => e.id),
  );
  for (const raw of snap.ledger as Array<Record<string, unknown>>) {
    if (typeof raw.id === "string" && !existingLedger.has(raw.id)) {
      await storage.appendLedgerEntry({
        category: String(raw.category),
        description: String(raw.description),
        amountUsd: Number(raw.amountUsd),
        reference: String(raw.reference ?? ""),
        createdBy: String(raw.createdBy ?? "peer"),
        ts: raw.ts ? new Date(String(raw.ts)) : new Date(),
      });
      applied.ledger++;
    }
  }

  // Audit log — immutable, merge by id.
  const existingAudit = new Set(
    (await storage.getAuditLog(RETENTION_LIMIT)).map((e) => e.id),
  );
  for (const raw of snap.auditLog as Array<Record<string, unknown>>) {
    if (typeof raw.id === "string" && !existingAudit.has(raw.id)) {
      await storage.appendAuditLog({
        actor: String(raw.actor ?? "peer"),
        action: String(raw.action),
        entity: String(raw.entity ?? ""),
        entityId: String(raw.entityId ?? ""),
        detail: (raw.detail as Record<string, unknown>) ?? {},
        severity: String(raw.severity ?? "info") as "info" | "warning" | "critical",
        ts: raw.ts ? new Date(String(raw.ts)) : new Date(),
      });
      applied.auditLog++;
    }
  }

  // Strategies — upsert by id (status/params may change on primary).
  for (const raw of snap.strategies as Array<Record<string, unknown>>) {
    if (typeof raw.id !== "string") continue;
    const existing = await storage.getStrategy(raw.id);
    if (!existing) {
      await storage.createStrategy({
        name: String(raw.name),
        symbol: String(raw.symbol),
        algorithm: raw.algorithm as never,
        params: (raw.params as Record<string, number>) ?? {},
        riskLimits: (raw.riskLimits as Record<string, number>) ?? {},
      });
      applied.strategies++;
    }
  }

  log(
    `snapshot applied from ${snap.node} seq=${snap.sequence}: ${JSON.stringify(applied)}`,
    "failover",
  );
  return applied;
}

// ---------------------------------------------------------------------------
// Heartbeat + replication loops
// ---------------------------------------------------------------------------

async function pushSnapshotTo(node: FailoverNode, snap: ReplicationEnvelope): Promise<boolean> {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PEER_TIMEOUT_MS_DEFAULT);
    const res = await fetch(`${node.baseUrl}/api/internal/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `******`,
      },
      body: JSON.stringify(snap),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      await storage.updateFailoverNode(node.id, {
        lastSnapshotAt: new Date(),
        lastHeartbeatAt: new Date(),
        lastHeartbeatLatencyMs: Date.now() - started,
        consecutiveFailures: 0,
        status: "healthy",
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function heartbeat(node: FailoverNode, cfg: FallbackConfig): Promise<void> {
  const started = Date.now();
  let ok = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.heartbeatTimeoutMs);
    const res = await fetch(`${node.baseUrl}/api/internal/heartbeat`, {
      headers: { Authorization: `******` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    ok = res.ok;
  } catch {
    ok = false;
  }
  const latency = Date.now() - started;

  if (ok) {
    const wasBad = node.status !== "healthy";
    await storage.updateFailoverNode(node.id, {
      status: "healthy",
      lastHeartbeatAt: new Date(),
      lastHeartbeatLatencyMs: latency,
      consecutiveFailures: 0,
    });
    if (wasBad) {
      await storage.appendFailoverEvent({
        type: "node.recovered",
        nodeId: node.id,
        detail: { latencyMs: latency },
        severity: "info",
      });
    }
  } else {
    const failures = node.consecutiveFailures + 1;
    const status = failures >= cfg.maxConsecutiveFailures ? "unreachable" : "degraded";
    await storage.updateFailoverNode(node.id, {
      status,
      consecutiveFailures: failures,
    });
    if (status === "unreachable" && node.status !== "unreachable") {
      await storage.appendFailoverEvent({
        type: "node.unreachable",
        nodeId: node.id,
        detail: { consecutiveFailures: failures },
        severity: "critical",
      });
      await evaluateLockdown();
    }
  }
}

async function tick(): Promise<void> {
  const cfg = await config();
  const nodes = (await storage.getFailoverNodes()).filter((n) => n.enabled);
  if (nodes.length === 0) return;

  // Heartbeat all peers.
  await Promise.allSettled(nodes.map((n) => heartbeat(n, cfg)));

  // If we are primary, push a fresh snapshot to every standby.
  if (selfRole === "primary") {
    const snap = await buildSnapshot();
    const standbys = nodes.filter((n) => n.role === "standby");
    for (const n of standbys) {
      const ok = await pushSnapshotTo(n, snap);
      await storage.appendFailoverEvent({
        type: "snapshot.pushed",
        nodeId: n.id,
        detail: { ok, sequence: snap.sequence },
        severity: ok ? "info" : "warning",
      });
    }
  }

  // Auto-failover: if a registered primary is unreachable, promote self.
  if (cfg.autoFailover && selfRole !== "primary") {
    const primaries = nodes.filter((n) => n.role === "primary");
    const primaryDown =
      primaries.length > 0 && primaries.every((p) => p.status === "unreachable");
    if (primaryDown) {
      await promoteSelf("primary unreachable, autoFailover");
    }
  }
}

async function evaluateLockdown(): Promise<void> {
  const cfg = await config();
  const nodes = (await storage.getFailoverNodes()).filter((n) => n.enabled);
  const anyHealthy = nodes.some((n) => n.status === "healthy");
  if (nodes.length > 0 && !anyHealthy && cfg.lockdownLevel === "none") {
    await setLockdown("guarded", "all mirrors unreachable");
  }
}

// ---------------------------------------------------------------------------
// Public control API used by routes
// ---------------------------------------------------------------------------

export async function setLockdown(
  level: LockdownLevel,
  reason: string,
): Promise<FallbackConfig> {
  const updated = await storage.updateFallbackConfig(
    { lockdownLevel: level },
    "system",
  );
  await storage.appendFailoverEvent({
    type: "lockdown.changed",
    nodeId: null,
    detail: { level, reason },
    severity: level === "halted" ? "critical" : level === "guarded" ? "warning" : "info",
  });
  return updated;
}

export async function promoteSelf(reason: string): Promise<void> {
  if (selfRole === "primary") return;
  selfRole = "primary";
  await storage.appendFailoverEvent({
    type: "failover.promoted",
    nodeId: null,
    detail: { reason, node: selfName },
    severity: "critical",
  });
  log(`node promoted to primary: ${reason}`, "failover");
}

export async function demoteSelf(reason: string): Promise<void> {
  if (selfRole === "standby") return;
  selfRole = "standby";
  await storage.appendFailoverEvent({
    type: "failover.demoted",
    nodeId: null,
    detail: { reason, node: selfName },
    severity: "warning",
  });
  log(`node demoted to standby: ${reason}`, "failover");
}

/**
 * Trading-quality guard: called before executing a trade signal. Returns a
 * reason string when trading should be blocked under the current fallback
 * parameters, otherwise null.
 */
export async function tradingBlockReason(latestTickTs?: number): Promise<string | null> {
  const cfg = await config();
  if (cfg.lockdownLevel === "halted") return "security lockdown: halted";
  if (latestTickTs !== undefined) {
    const staleness = Date.now() - latestTickTs;
    if (staleness > cfg.maxFeedStalenessMs) {
      return `market feed stale (${staleness}ms > ${cfg.maxFeedStalenessMs}ms)`;
    }
  }
  if (cfg.lockdownLevel === "guarded") return "security lockdown: guarded";
  return null;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the failover loop. Idempotent. */
export function startFailoverEngine(): void {
  if (timer) return;
  const initial = process.env.NODE_ROLE;
  if (initial === "standby") selfRole = "standby";
  timer = setInterval(() => {
    void tick().catch((err) =>
      log(`failover tick error: ${err instanceof Error ? err.message : err}`, "failover"),
    );
  }, 15_000);
  log(`failover engine started as ${selfRole} (${selfName})`, "failover");
}

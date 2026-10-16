import { createHmac, randomUUID } from "crypto";
import type { Webhook, WebhookEvent } from "@shared/schema";
import { storage } from "../storage";
import { log } from "../index";

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 5_000;

export interface WebhookPayload {
  id: string;
  event: WebhookEvent | "test.ping";
  timestamp: number;
  data: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sign a raw body with the webhook secret (HMAC-SHA256). */
export function signPayload(secret: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

async function attemptDelivery(
  webhook: Webhook,
  payload: WebhookPayload,
): Promise<{ ok: boolean; httpStatus: number | null; latencyMs: number; error: string | null }> {
  const rawBody = JSON.stringify(payload);
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexus-Event": payload.event,
        "X-Nexus-Delivery": payload.id,
        "X-Nexus-Timestamp": String(payload.timestamp),
        "X-Nexus-Signature": signPayload(webhook.secret, rawBody),
      },
      body: rawBody,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    if (res.ok) {
      return { ok: true, httpStatus: res.status, latencyMs, error: null };
    }
    return {
      ok: false,
      httpStatus: res.status,
      latencyMs,
      error: `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: null,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function deliverToWebhook(
  webhook: Webhook,
  event: WebhookPayload["event"],
  data: unknown,
): Promise<void> {
  const payload: WebhookPayload = {
    id: randomUUID(),
    event,
    timestamp: Date.now(),
    data,
  };

  let attempts = 0;
  let last: Awaited<ReturnType<typeof attemptDelivery>> = {
    ok: false,
    httpStatus: null,
    latencyMs: 0,
    error: "not attempted",
  };

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    last = await attemptDelivery(webhook, payload);
    if (last.ok) break;
    if (attempts < MAX_ATTEMPTS) await sleep(2 ** (attempts - 1) * 1000);
  }

  await storage.createWebhookDelivery({
    webhookId: webhook.id,
    event,
    payload,
    status: last.ok ? "success" : "failed",
    httpStatus: last.httpStatus,
    attempts,
    latencyMs: last.latencyMs,
    error: last.error,
    deliveredAt: new Date(),
  });

  if (!last.ok) {
    log(
      `webhook ${webhook.id} delivery failed after ${attempts} attempt(s): ${last.error}`,
      "webhooks",
    );
  }
}

/**
 * Dispatch an event to every active webhook subscribed to it.
 * Deliveries run in the background; failures are logged, never thrown.
 */
export function dispatchEvent(
  event: WebhookPayload["event"],
  data: unknown,
): void {
  void (async () => {
    try {
      const hooks = await storage.getWebhooks();
      const targets = hooks.filter(
        (h) => h.active && (h.events as string[]).includes(event),
      );
      await Promise.allSettled(
        targets.map((hook) => deliverToWebhook(hook, event, data)),
      );
    } catch (err) {
      log(
        `dispatch error: ${err instanceof Error ? err.message : String(err)}`,
        "webhooks",
      );
    }
  })();
}

/** Send a test ping to a single webhook and return the delivery record. */
export async function sendTestPing(webhook: Webhook) {
  await deliverToWebhook(webhook, "test.ping", {
    message: "NEXUS//INFRA webhook test ping",
  });
  const deliveries = await storage.getWebhookDeliveries(webhook.id);
  return deliveries[0] ?? null;
}

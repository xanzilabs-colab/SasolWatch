const ZERNIO_API_BASE = "https://zernio.com/api/v1";
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type Subscriber = {
  id: number;
  phone: string;
  status: "active" | "unsubscribed";
  last_inbound_at: string | null;
  zernio_conversation_id: string | null;
  account_id: string | null;
};

export type Delivery = {
  delivery_key: string;
  subscriber_id: number;
  alert_id: number | null;
  phone: string;
  zernio_conversation_id: string | null;
  account_id: string | null;
  last_inbound_at: string | null;
  message: string;
};

export function secureEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

export async function verifyZernioSignature(
  body: string | Uint8Array,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature) || !secret) return false;
  const bodyBytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, bodyBytes));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return secureEqual(signature, expected);
}

export function eventIdentity(payload: Record<string, unknown>, headerId: string | null): string | null {
  const bodyId = typeof payload.id === "string" ? payload.id.trim() : "";
  const eventId = headerId?.trim() ?? "";
  if (bodyId && eventId && bodyId !== eventId) return null;
  return bodyId || eventId || null;
}

export function duplicateDisposition(
  status: string | null | undefined,
  updatedAt?: string,
  now = Date.now(),
  attempts = 0,
): "process" | "retry" | "skip" {
  if (status === "pending") return "process";
  if (attempts < 5 && status === "failed") return "retry";
  if (attempts < 5 && status === "processing" && updatedAt && now - Date.parse(updatedAt) > 120_000) return "retry";
  return "skip";
}

export function isInboundDirection(direction: unknown): boolean {
  return typeof direction === "string" && ["incoming", "inbound"].includes(direction.toLowerCase());
}

export function isWhatsAppPlatform(platform: unknown): boolean {
  return typeof platform === "string" && platform.toLowerCase() === "whatsapp";
}

export function inboundCommand(text: string | null | undefined): "subscribe" | "unsubscribe" | "help" {
  const normalized = (text ?? "").trim().toLowerCase();
  if (normalized === "stop" || normalized === "unsubscribe") return "unsubscribe";
  if (normalized.includes("hello") || normalized.includes("alerts")) return "subscribe";
  return "help";
}

export function normalizeE164(phone: unknown, fallbackId?: unknown): string | null {
  const candidate = typeof phone === "string" && phone ? phone : fallbackId;
  if (typeof candidate !== "string") return null;
  let normalized = candidate.trim();
  if (/^\d{8,15}$/.test(normalized)) normalized = `+${normalized}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return null;
  return normalized;
}

export function insideWhatsAppWindow(lastInboundAt: string | null, now = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const timestamp = Date.parse(lastInboundAt);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < WINDOW_MS;
}

async function zernioRequest(
  apiKey: string,
  path: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${ZERNIO_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const errorCode = typeof body.code === "string" ? body.code : "";
    const error = new Error(`Zernio send failed (${response.status}${errorCode ? `, ${errorCode}` : ""})`);
    Object.assign(error, { status: response.status, errorCode });
    throw error;
  }
  return { status: response.status, body };
}

function providerMessageId(body: Record<string, unknown>): string | null {
  const message = body.message && typeof body.message === "object"
    ? body.message as Record<string, unknown>
    : null;
  const data = body.data && typeof body.data === "object"
    ? body.data as Record<string, unknown>
    : null;
  const id = message?.id ?? data?.messageId ?? data?.id;
  return typeof id === "string" ? id : null;
}

async function sendOnce(apiKey: string, delivery: Delivery, templateName: string, templateLanguage: string) {
  if (!delivery.account_id) throw new Error("subscriber has no Zernio account id");
  if (insideWhatsAppWindow(delivery.last_inbound_at)) {
    if (!delivery.zernio_conversation_id) throw new Error("subscriber has no Zernio conversation id");
    const conversationId = encodeURIComponent(delivery.zernio_conversation_id);
    return await zernioRequest(
      apiKey,
      `/inbox/conversations/${conversationId}/messages`,
      { accountId: delivery.account_id, message: delivery.message },
      delivery.delivery_key,
    );
  }
  if (!templateName || !templateLanguage) throw new Error("approved WhatsApp template is not configured");
  return await zernioRequest(
    apiKey,
    "/inbox/conversations",
    {
      accountId: delivery.account_id,
      participantId: delivery.phone.replace(/\D/g, ""),
      templateName,
      templateLanguage,
      templateParams: [delivery.message],
    },
    delivery.delivery_key,
  );
}

export async function queueSubscriberAlert(
  db: any,
  message: string,
  options: {
    eventId?: number | null;
    severityRank?: number;
    alertId?: number | null;
    alertIdBySubscriber?: Record<number, number>;
    batchId?: string;
    dryRun: boolean;
  },
): Promise<Delivery[]> {
  const { data: subscribers, error: subscribersError } = await db
    .from("subscribers")
    .select("id,phone,status,last_inbound_at,zernio_conversation_id,account_id")
    .eq("status", "active");
  if (subscribersError) throw new Error("Could not load active WhatsApp subscribers");

  const rows = ((subscribers ?? []) as Subscriber[]).map((subscriber) => ({
    delivery_key: options.eventId != null
      ? `event-${options.eventId}-severity-${options.severityRank ?? 0}-subscriber-${subscriber.id}`
      : `manual-${options.batchId ?? crypto.randomUUID()}-subscriber-${subscriber.id}`,
    event_id: options.eventId ?? null,
    severity_rank: options.severityRank ?? 0,
    alert_id: options.alertIdBySubscriber?.[subscriber.id] ?? options.alertId ?? null,
    subscriber_id: subscriber.id,
    phone: subscriber.phone,
    message,
    status: options.dryRun ? "dry_run" : "pending",
  }));
  if (rows.length === 0) return [];

  const { data, error } = await db
    .from("subscriber_alert_deliveries")
    .upsert(rows, { onConflict: "delivery_key", ignoreDuplicates: true })
    .select("delivery_key,subscriber_id,alert_id");
  if (error) throw new Error("Could not queue WhatsApp alerts");

  const queued = (data ?? []) as Array<{ delivery_key: string; subscriber_id: number; alert_id: number | null }>;
  if (options.dryRun || queued.length === 0) return [];
  const subscriberIds = queued.map((delivery) => delivery.subscriber_id);
  const { data: deliveryDetails, error: detailError } = await db
    .from("subscribers")
    .select("id,phone,last_inbound_at,zernio_conversation_id,account_id")
    .in("id", subscriberIds);
  if (detailError) throw new Error("Could not prepare queued WhatsApp alerts");
  const byId = new Map((deliveryDetails as Subscriber[]).map((subscriber) => [subscriber.id, subscriber]));
  return queued.flatMap((delivery) => {
    const subscriber = byId.get(delivery.subscriber_id);
    if (!subscriber) return [];
    return [{
      ...delivery,
      phone: subscriber.phone,
      last_inbound_at: subscriber.last_inbound_at,
      zernio_conversation_id: subscriber.zernio_conversation_id,
      account_id: subscriber.account_id,
      message,
    }];
  });
}

export async function sendQueuedSubscriberAlerts(db: any, deliveries: Delivery[]): Promise<void> {
  const apiKey = Deno.env.get("ZERNIO_WHATSAPP_API_KEY") ?? Deno.env.get("ZERNIO_API_KEY") ?? "";
  const templateName = Deno.env.get("ZERNIO_ALERT_TEMPLATE_NAME") ?? "alert_notification";
  const templateLanguage = Deno.env.get("ZERNIO_ALERT_TEMPLATE_LANGUAGE") ?? "en_US";
  for (const delivery of deliveries) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (!apiKey) throw new Error("Zernio API key is not configured");
        const result = await sendOnce(apiKey, delivery, templateName, templateLanguage);
        const { error: deliveryError } = await db.from("subscriber_alert_deliveries").update({
          status: "sent",
          attempts: attempt,
          provider_status: result.status,
          provider_message_id: providerMessageId(result.body),
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("delivery_key", delivery.delivery_key);
        if (deliveryError) throw new Error("Could not record WhatsApp delivery");
        if (delivery.alert_id != null) {
          const { error: alertError } = await db.from("alerts").update({
            status: "sent",
            provider_status: result.status,
          }).eq("id", delivery.alert_id);
          if (alertError) throw new Error("Could not update alert status");
        }
        break;
      } catch (error) {
        const status = Number((error as { status?: number }).status ?? 0);
        const errorCode = String((error as { errorCode?: string }).errorCode ?? "");
        const retryable = status === 0 || status === 429 || status >= 500 || errorCode === "131056";
        if (attempt === 3 || !retryable) {
          const { error: deliveryError } = await db.from("subscriber_alert_deliveries").update({
            status: "failed",
            attempts: attempt,
            provider_status: status || null,
            last_error: error instanceof Error ? error.message.slice(0, 160) : "send failed",
            updated_at: new Date().toISOString(),
          }).eq("delivery_key", delivery.delivery_key);
          if (deliveryError) console.error("Could not record failed WhatsApp delivery", delivery.delivery_key);
          if (delivery.alert_id != null) {
            const { error: alertError } = await db.from("alerts").update({
              status: "failed",
              provider_status: status || null,
            }).eq("id", delivery.alert_id);
            if (alertError) console.error("Could not update failed alert", delivery.alert_id);
          }
          console.error(
            "Zernio subscriber delivery failed",
            delivery.delivery_key,
            error instanceof Error ? error.message : "send failed",
          );
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** (attempt - 1))));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
}

export async function sendConversationReply(
  apiKey: string,
  accountId: string,
  conversationId: string,
  message: string,
  idempotencyKey: string,
): Promise<void> {
  await zernioRequest(
    apiKey,
    `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
    { accountId, message },
    idempotencyKey,
  );
}

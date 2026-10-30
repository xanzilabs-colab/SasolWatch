import { createClient } from "npm:@supabase/supabase-js@2";
import {
  duplicateDisposition,
  eventIdentity,
  inboundCommand,
  isInboundDirection,
  isWhatsAppPlatform,
  normalizeE164,
  sendConversationReply,
  verifyZernioSignature,
} from "../_shared/zernio.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const webhookSecret = Deno.env.get("ZERNIO_WEBHOOK_SECRET") ?? "";
const apiKey = Deno.env.get("ZERNIO_WHATSAPP_API_KEY") ?? Deno.env.get("ZERNIO_API_KEY") ?? "";
const useSandbox = Deno.env.get("USE_SANDBOX") === "true";
const configuredAccountId = Deno.env.get("ZERNIO_ACCOUNT_ID") ?? "";
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function redactPhone(phone: string | null) {
  return phone ? `${phone.slice(0, 3)}***${phone.slice(-2)}` : null;
}

function sanitizedPayload(payload: Record<string, any>, eventType: string, phone: string | null) {
  const message = payload.message && typeof payload.message === "object" ? payload.message : {};
  const sender = message.sender && typeof message.sender === "object" ? message.sender : {};
  const account = payload.account && typeof payload.account === "object" ? payload.account : {};
  const failure = payload.error && typeof payload.error === "object" ? payload.error : {};
  return {
    event: eventType,
    test: payload.test === true,
    account_id: typeof account.accountId === "string" ? account.accountId : null,
    account_keys: Object.keys(account),
    message_keys: Object.keys(message),
    sender_keys: Object.keys(sender),
    message: {
      id: typeof message.id === "string" ? message.id : null,
      conversationId: typeof message.conversationId === "string" ? message.conversationId : null,
      platform: typeof message.platform === "string" ? message.platform : null,
      direction: typeof message.direction === "string" ? message.direction : null,
      text: message.text == null ? null : "[REDACTED]",
      sender: { phone: redactPhone(phone) },
    },
    error_code: typeof failure.code === "string" || typeof failure.code === "number"
      ? String(failure.code)
      : null,
    error_reason: typeof failure.message === "string"
      ? failure.message.replace(/\+?\d[\d\s().-]{7,}\d/g, "[REDACTED PHONE]").slice(0, 160)
      : null,
  };
}

async function recordSanitizedSample(eventId: string, payload: Record<string, any>, eventType: string, phone: string | null) {
  const sample = sanitizedPayload(payload, eventType, phone);
  const { data, error } = await db.from("zernio_webhook_samples")
    .insert({ event_id: eventId, event_type: eventType, payload: sample })
    .select("event_id")
    .maybeSingle();
  if (error && error.code !== "23505") throw new Error("Unable to record sanitized webhook sample");
  if (data) console.info("ZERNIO_REDACTED_REAL_PAYLOAD", JSON.stringify(sample));
}

async function updateEvent(eventId: string, values: Record<string, unknown>) {
  const { error } = await db.from("zernio_webhook_events").update(values).eq("event_id", eventId);
  if (error) throw new Error("Unable to update webhook event");
}

async function processEvent(eventId: string) {
  const { data: pending, error: pendingError } = await db.from("zernio_webhook_events")
    .select("attempts")
    .eq("event_id", eventId)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingError) throw new Error("Unable to load pending webhook event");
  if (!pending) return;

  const { data: claimed, error: claimError } = await db.from("zernio_webhook_events")
    .update({
      status: "processing",
      attempts: (pending.attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", eventId)
    .eq("status", "pending")
    .select("event_id,event_type,payload,message_phone,message_text,attempts")
    .maybeSingle();
  if (claimError) throw new Error("Unable to claim webhook event");
  if (!claimed) return;

  try {
    const payload = claimed.payload as Record<string, any>;
    if (claimed.event_type === "message.received") {
      const message = payload.message && typeof payload.message === "object" ? payload.message : {};
      if (payload.test === true || !isInboundDirection(message.direction) || !isWhatsAppPlatform(message.platform)) {
        await updateEvent(eventId, {
          status: "completed",
          message_text: null,
          message_phone: null,
          processed_at: new Date().toISOString(),
        });
        return;
      }
      const phone = normalizeE164(claimed.message_phone);
      if (!phone) {
        await updateEvent(eventId, {
          status: "completed",
          message_text: null,
          message_phone: null,
          processing_error: "no_e164_sender_number",
          processed_at: new Date().toISOString(),
        });
        return;
      }
      const command = inboundCommand(claimed.message_text);
      const accountId = typeof payload.account_id === "string" ? payload.account_id : null;
      const conversationId = typeof message.conversationId === "string" ? message.conversationId : null;
      if (useSandbox) {
        const { data: sandboxConfig, error: sandboxConfigError } = await db
          .from("zernio_runtime_config")
          .select("config_value")
          .eq("config_key", "sandbox_session")
          .maybeSingle();
        if (sandboxConfigError) throw new Error("Unable to load sandbox session");
        const sandbox = sandboxConfig?.config_value as { phone?: unknown; status?: string } | null;
        const allowedPhone = normalizeE164(sandbox?.phone);
        if (
          !allowedPhone ||
          phone !== allowedPhone ||
          !accountId ||
          (configuredAccountId && accountId !== configuredAccountId)
        ) {
          await updateEvent(eventId, {
            status: "completed",
            message_text: null,
            message_phone: null,
            processing_error: "message_not_from_active_sandbox_recipient",
            processed_at: new Date().toISOString(),
          });
          return;
        }
        const { error: sessionError } = await db.from("zernio_runtime_config").upsert({
          config_key: "sandbox_session",
          config_value: {
            ...sandbox,
            phone: allowedPhone,
            accountId,
            status: "active",
            activatedAt: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: "config_key" });
        if (sessionError) throw new Error("Unable to activate sandbox recipient");
      } else if (configuredAccountId && accountId && accountId !== configuredAccountId) {
        await updateEvent(eventId, {
          status: "completed",
          message_text: null,
          message_phone: null,
          processing_error: "message_from_unconfigured_account",
          processed_at: new Date().toISOString(),
        });
        return;
      }
      const { error: subscriberError } = await db.rpc("upsert_zernio_subscriber", {
        p_phone: phone,
        p_action: command,
        p_conversation_id: conversationId,
        p_account_id: accountId,
        p_last_inbound_at: new Date().toISOString(),
      });
      if (subscriberError) throw new Error("Unable to update subscriber");

      const responseText = command === "subscribe"
        ? "You're subscribed to alerts. Reply STOP to unsubscribe."
        : command === "unsubscribe"
          ? "You've been unsubscribed."
          : "Reply ALERTS to subscribe, STOP to unsubscribe.";
      if (apiKey && accountId && conversationId) {
        await sendConversationReply(apiKey, accountId, conversationId, responseText, `zernio-${eventId}-reply`);
      } else {
        throw new Error("Zernio reply is missing API key, account id, or conversation id");
      }
    } else if (claimed.event_type === "message.failed") {
      const failedMessageId = typeof payload.message_id === "string"
        ? payload.message_id
        : typeof payload.messageId === "string"
          ? payload.messageId
          : null;
      const errorCode = typeof payload.error_code === "string" ? payload.error_code : null;
      if (failedMessageId) {
        const { data: failedDeliveries, error: deliveryError } = await db
          .from("subscriber_alert_deliveries")
          .update({
            status: "failed",
            last_error: errorCode ? `Zernio message.failed (${errorCode})` : "Zernio message.failed",
            updated_at: new Date().toISOString(),
          })
          .eq("provider_message_id", failedMessageId)
          .select("alert_id");
        if (deliveryError) throw new Error("Unable to record failed Zernio message");
        const alertIds = (failedDeliveries ?? []).map((delivery: { alert_id: number | null }) => delivery.alert_id)
          .filter((id: number | null): id is number => id != null);
        if (alertIds.length) {
          const { error: alertError } = await db.from("alerts").update({ status: "failed" }).in("id", alertIds);
          if (alertError) throw new Error("Unable to update failed alert status");
        }
      }
      console.warn("Zernio reported a failed message", JSON.stringify({
        eventId,
        errorCode,
        reason: typeof payload.error_reason === "string" ? payload.error_reason : null,
        messageId: failedMessageId,
      }));
    } else if (claimed.event_type === "whatsapp.template.status_updated") {
      console.info("Zernio WhatsApp template status changed", JSON.stringify({
        eventId,
        templateName: payload.template_name ?? null,
        status: payload.template_status ?? null,
      }));
    }
    await updateEvent(eventId, {
      status: "completed",
      processing_error: null,
      message_text: null,
      message_phone: null,
      processed_at: new Date().toISOString(),
    });
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message.slice(0, 160) : "event processing failed";
    const { error: failureError } = await db.from("zernio_webhook_events").update({
      status: "failed",
      processing_error: safeMessage,
      updated_at: new Date().toISOString(),
    }).eq("event_id", eventId);
    if (failureError) console.error("Could not mark Zernio event failed", eventId);
    console.error("Zernio webhook processing failed", eventId, safeMessage);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (!webhookSecret) return json({ error: "Webhook is not configured" }, 503);

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.length > 1024 * 1024) return json({ error: "Payload too large" }, 413);
  const validSignature = await verifyZernioSignature(
    rawBody,
    request.headers.get("X-Zernio-Signature"),
    webhookSecret,
  );
  if (!validSignature) return json({ error: "Invalid signature" }, 401);

  let payload: Record<string, any>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(rawBody));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Invalid payload" }, 400);
    payload = parsed as Record<string, any>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const eventId = eventIdentity(payload, request.headers.get("X-Zernio-Event-Id"));
  const headerEvent = request.headers.get("X-Zernio-Event");
  const bodyEvent = typeof payload.event === "string" ? payload.event : "";
  if (!eventId || !bodyEvent || (headerEvent && headerEvent !== bodyEvent)) {
    return json({ error: "Event id or event type is missing or inconsistent" }, 400);
  }

  const message = payload.message && typeof payload.message === "object" ? payload.message : {};
  const sender = message.sender && typeof message.sender === "object" ? message.sender : {};
  const phone = normalizeE164(sender.phoneNumber, sender.id);
  const safePayload = bodyEvent === "message.received"
    ? sanitizedPayload(payload, bodyEvent, phone)
    : {
      event: bodyEvent,
      test: payload.test === true,
      account_id: payload.account?.accountId ?? null,
      message_id: message.id ?? null,
      error_code: typeof payload.error?.code === "string" || typeof payload.error?.code === "number"
        ? String(payload.error.code)
        : typeof payload.code === "string" || typeof payload.code === "number"
          ? String(payload.code)
          : null,
      error_reason: typeof payload.error?.message === "string"
        ? payload.error.message.replace(/\+?\d[\d\s().-]{7,}\d/g, "[REDACTED PHONE]").slice(0, 160)
        : null,
      template_name: payload.template?.name ?? payload.templateName ?? null,
      template_status: payload.template?.status ?? payload.status ?? null,
    };

  if (bodyEvent === "message.received" && payload.test !== true) {
    try {
      await recordSanitizedSample(eventId, payload, bodyEvent, phone);
    } catch (error) {
      console.error("Could not record redacted Zernio sample", error instanceof Error ? error.message : "unknown error");
    }
  }

  const { error: insertError } = await db.from("zernio_webhook_events").insert({
    event_id: eventId,
    event_type: bodyEvent,
    payload: safePayload,
    message_phone: bodyEvent === "message.received" &&
        payload.test !== true &&
        isInboundDirection(message.direction) &&
        isWhatsAppPlatform(message.platform)
      ? phone
      : null,
    message_text: bodyEvent === "message.received" &&
        payload.test !== true &&
        isInboundDirection(message.direction) &&
        isWhatsAppPlatform(message.platform) &&
        typeof message.text === "string"
      ? message.text.slice(0, 4000)
      : null,
    status: "pending",
  });
  if (insertError && insertError.code !== "23505") {
    console.error("Could not persist Zernio event", insertError.code);
    return json({ error: "Could not persist event" }, 500);
  }

  if (insertError?.code === "23505") {
    const { data: existing } = await db.from("zernio_webhook_events").select("status,updated_at,attempts")
      .eq("event_id", eventId).maybeSingle();
    const disposition = duplicateDisposition(existing?.status, existing?.updated_at, Date.now(), existing?.attempts ?? 0);
    if (disposition === "retry") {
      const { error: retryError } = await db.from("zernio_webhook_events")
        .update({ status: "pending", processing_error: null, updated_at: new Date().toISOString() })
        .eq("event_id", eventId)
        .eq("status", existing?.status);
      if (retryError) return json({ error: "Could not retry event" }, 500);
      EdgeRuntime.waitUntil(processEvent(eventId));
    } else if (disposition === "process") {
      EdgeRuntime.waitUntil(processEvent(eventId));
    }
    return json({ ok: true, duplicate: true });
  }

  EdgeRuntime.waitUntil(processEvent(eventId));
  return json({ ok: true, accepted: true }, 202);
});

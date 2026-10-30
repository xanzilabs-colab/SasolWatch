import { createClient } from "npm:@supabase/supabase-js@2";
import {
  queueSubscriberAlert,
  secureEqual,
  sendQueuedSubscriberAlerts,
} from "../_shared/zernio.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const apiKey = Deno.env.get("ZERNIO_WHATSAPP_API_KEY") ?? Deno.env.get("ZERNIO_API_KEY") ?? "";
const adminKey = Deno.env.get("ZERNIO_ADMIN_KEY") ?? "";
const webhookSecret = Deno.env.get("ZERNIO_WEBHOOK_SECRET") ?? "";
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const API_BASE = "https://zernio.com/api/v1";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function zernioPost(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const code = typeof result.code === "string" ? result.code : "provider_error";
    throw new Error(`Zernio request failed (${response.status}, ${code})`);
  }
  return result;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (!adminKey || !secureEqual(request.headers.get("x-admin-key") ?? "", adminKey)) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!apiKey) return json({ error: "Zernio API key is not configured" }, 503);

  const rawBody = await request.text();
  if (rawBody.length > 16_384) return json({ error: "Payload too large" }, 413);
  let body: Record<string, any>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Invalid payload" }, 400);
    body = parsed as Record<string, any>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  try {
    if (body.action === "list_accounts") {
      const response = await fetch(`${API_BASE}/accounts`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return json({ error: `Zernio accounts request failed (${response.status})` }, 502);
      const result = await response.json() as { accounts?: Array<Record<string, unknown>> };
      return json({
        accounts: (result.accounts ?? []).map((account) => ({
          accountId: account.accountId ?? account._id ?? account.id,
          platform: account.platform,
          name: account.name,
          status: account.status,
        })),
      });
    }

    if (body.action === "register_webhook") {
      if (!webhookSecret) return json({ error: "ZERNIO_WEBHOOK_SECRET is not configured" }, 503);
      const publicUrl = typeof body.publicUrl === "string"
        ? body.publicUrl.trim()
        : `${supabaseUrl}/functions/v1/zernio-webhook`;
      if (!publicUrl.startsWith("https://")) return json({ error: "Webhook URL must use HTTPS" }, 400);
      const created = await zernioPost("/webhooks/settings", {
        name: "SasolSniff WhatsApp subscriptions",
        url: publicUrl,
        secret: webhookSecret,
        events: [
          "message.received",
          "message.failed",
          "account.disconnected",
          "whatsapp.template.status_updated",
        ],
      });
      const webhookId = created.webhook?._id;
      if (typeof webhookId !== "string" || !webhookId) {
        throw new Error("Zernio webhook settings response did not include webhook._id");
      }
      const testStartedAt = new Date().toISOString();
      const test = await zernioPost("/webhooks/test", { webhookId });
      let testEvent: { event_id: string; status: string } | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const { data, error } = await db.from("zernio_webhook_events")
          .select("event_id,status")
          .eq("event_type", "webhook.test")
          .gte("received_at", testStartedAt)
          .order("received_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error("Could not verify Zernio webhook test delivery");
        if (data) {
          testEvent = data;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return json({
        webhookId,
        url: publicUrl,
        testRequested: true,
        testAccepted: test.success ?? null,
        testEventReceived: testEvent != null,
        testEventStatus: testEvent?.status ?? null,
      }, testEvent ? 201 : 202);
    }

    if (body.action === "create_template") {
      const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
      if (!accountId) return json({ error: "accountId is required" }, 400);
      const result = await zernioPost("/whatsapp/templates", {
        accountId,
        name: "alert_notification",
        category: "UTILITY",
        language: "en_US",
        parameter_format: "POSITIONAL",
        components: [{
          type: "body",
          text: "SasolSniff air quality alert: {{1}}",
          example: { body_text: [["A sensor detected a pollution surge."]] },
        }],
      });
      return json({ template: result.template ?? result }, 201);
    }

    if (body.action === "send_alert") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text || text.length > 1000) return json({ error: "text must contain 1-1000 characters" }, 400);
      const { count, error: countError } = await db.from("subscribers")
        .select("id", { count: "exact", head: true }).eq("status", "active");
      if (countError) throw new Error("Could not count active subscribers");
      const dryRun = (Deno.env.get("ALERT_DRY_RUN") ?? "true") !== "false";
      const deliveries = await queueSubscriberAlert(db, text, { batchId: crypto.randomUUID(), dryRun });
      if (deliveries.length) EdgeRuntime.waitUntil(sendQueuedSubscriberAlerts(db, deliveries));
      return json({
        accepted: true,
        dryRun,
        subscriberCount: count ?? 0,
        queued: deliveries.length,
      }, 202);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zernio admin operation failed";
    console.error("Zernio admin operation failed", message);
    return json({ error: message }, 502);
  }
});

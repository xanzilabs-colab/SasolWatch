import { createClient } from "npm:@supabase/supabase-js@2";
import {
  normalizeE164,
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
const useSandbox = Deno.env.get("USE_SANDBOX") === "true";
const configuredAccountId = Deno.env.get("ZERNIO_ACCOUNT_ID") ?? "";

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

async function zernioGet(path: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const code = typeof result.code === "string" ? result.code : "provider_error";
    throw new Error(`Zernio request failed (${response.status}, ${code})`);
  }
  return result;
}

async function sandboxConfig() {
  const { data, error } = await db.from("zernio_runtime_config")
    .select("config_value")
    .eq("config_key", "sandbox_session")
    .maybeSingle();
  if (error) throw new Error("Could not load sandbox session configuration");
  return data?.config_value as {
    phone?: string;
    sessionId?: string;
    status?: string;
    activatedAt?: string | null;
    expiresAt?: string | null;
    accountId?: string;
  } | null;
}

async function saveSandboxConfig(value: Record<string, unknown>) {
  const { error } = await db.from("zernio_runtime_config").upsert({
    config_key: "sandbox_session",
    config_value: value,
    updated_at: new Date().toISOString(),
  }, { onConflict: "config_key" });
  if (error) throw new Error("Could not save sandbox session configuration");
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
    if (body.action === "discover_sandbox") {
      const numbers = await zernioGet("/phone-numbers");
      const sandbox = numbers.sandbox;
      if (!sandbox || typeof sandbox.accountId !== "string" || typeof sandbox.phoneNumber !== "string") {
        return json({ error: "Zernio has no WhatsApp sandbox configured" }, 404);
      }
      return json({
        sandbox: {
          accountId: sandbox.accountId,
          phoneNumber: sandbox.phoneNumber,
          template: sandbox.template,
          isSandbox: sandbox.isSandbox === true,
        },
      });
    }

    if (body.action === "activate_sandbox") {
      if (!useSandbox) return json({ error: "USE_SANDBOX must be true to activate a sandbox phone" }, 409);
      const phone = normalizeE164(body.phone);
      if (!phone) return json({ error: "phone must be a valid E.164 number" }, 400);
      const numbers = await zernioGet("/phone-numbers");
      const sandbox = numbers.sandbox;
      if (!sandbox || !sandbox.accountId || !sandbox.phoneNumber || !sandbox.template?.name || !sandbox.template?.language) {
        return json({ error: "Zernio sandbox account or locked template is not available" }, 503);
      }
      if (normalizeE164(sandbox.phoneNumber) === phone) {
        return json({ error: "The test phone cannot be the shared sandbox sender" }, 400);
      }
      if (configuredAccountId && configuredAccountId !== sandbox.accountId) {
        return json({ error: "Configured ZERNIO_ACCOUNT_ID does not match the discovered sandbox account" }, 409);
      }
      const started = await zernioPost("/whatsapp/sandbox/sessions", { phone });
      const session = started.session;
      if (!session || typeof session.id !== "string") {
        throw new Error("Zernio sandbox activation response did not include a session id");
      }
      await saveSandboxConfig({
        phone,
        sessionId: session.id,
        status: session.status,
        activatedAt: session.activatedAt ?? null,
        expiresAt: session.expiresAt ?? null,
        accountId: sandbox.accountId,
        sandboxNumber: sandbox.phoneNumber,
        template: sandbox.template,
      });
      return json({
        phone,
        sessionId: session.id,
        status: session.status,
        expiresAt: session.expiresAt ?? null,
        sandboxNumber: sandbox.phoneNumber,
        template: sandbox.template,
        nextStep: "Open WhatsApp on the test phone and reply to the sandbox activation message.",
      }, 201);
    }

    if (body.action === "sandbox_status") {
      if (!useSandbox) return json({ error: "USE_SANDBOX is not enabled" }, 409);
      const configured = await sandboxConfig();
      if (!configured?.phone) return json({ error: "No sandbox phone has been activated yet" }, 404);
      const result = await zernioGet("/whatsapp/sandbox/sessions");
      const session = (result.sessions ?? []).find((item: Record<string, unknown>) =>
        normalizeE164(item.phoneE164) === normalizeE164(configured.phone)
      );
      if (!session) return json({ phone: configured.phone, status: "not_found" }, 404);
      await saveSandboxConfig({
        ...configured,
        status: session.status,
        activatedAt: session.activatedAt ?? null,
        expiresAt: session.expiresAt ?? null,
      });
      return json({
        phone: configured.phone,
        status: session.status,
        activatedAt: session.activatedAt ?? null,
        expiresAt: session.expiresAt ?? null,
      });
    }

    if (body.action === "revoke_sandbox") {
      if (!useSandbox) return json({ error: "USE_SANDBOX is not enabled" }, 409);
      const configured = await sandboxConfig();
      if (!configured?.sessionId) return json({ error: "No sandbox session to revoke" }, 404);
      await fetch(`${API_BASE}/whatsapp/sandbox/sessions/${encodeURIComponent(configured.sessionId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      }).then(async (response) => {
        if (!response.ok) {
          const result = await response.json().catch(() => ({})) as Record<string, unknown>;
          const code = typeof result.code === "string" ? result.code : "provider_error";
          throw new Error(`Zernio request failed (${response.status}, ${code})`);
        }
      });
      await saveSandboxConfig({ ...configured, status: "revoked" });
      return json({ revoked: true, phone: configured.phone });
    }

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
      const webhookConfig: Record<string, unknown> = {
        name: "SasolSniff WhatsApp subscriptions",
        url: publicUrl,
        secret: webhookSecret,
        events: [
          "message.received",
          "message.failed",
          "account.disconnected",
          "whatsapp.template.status_updated",
        ],
      };
      if (useSandbox && configuredAccountId) webhookConfig.accountIds = [configuredAccountId];
      const created = await zernioPost("/webhooks/settings", webhookConfig);
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
      if (useSandbox) return json({ error: "The shared WhatsApp sandbox only allows its locked template" }, 409);
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
      const forceSend = body.forceSend === true;
      if (forceSend && !useSandbox) {
        return json({ error: "Force-send is allowed only while USE_SANDBOX=true" }, 409);
      }
      const configured = useSandbox ? await sandboxConfig() : null;
      if (useSandbox && configured?.status !== "active") {
        return json({
          error: "The sandbox session is not active. Reply to its activation message and check sandbox_status.",
          status: configured?.status ?? "not_started",
        }, 409);
      }
      let countQuery = db.from("subscribers")
        .select("id", { count: "exact", head: true }).eq("status", "active");
      if (configured?.phone) countQuery = countQuery.eq("phone", configured.phone);
      const { count, error: countError } = await countQuery;
      if (countError) throw new Error("Could not count active subscribers");
      const dryRun = !forceSend && (Deno.env.get("ALERT_DRY_RUN") ?? "true") !== "false";
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

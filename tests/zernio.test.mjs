import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  alertTemplateConfig,
  alertTemplateParams,
  duplicateDisposition,
  eventIdentity,
  inboundCommand,
  insideWhatsAppWindow,
  isInboundDirection,
  normalizeE164,
  sandboxRecipientAllowed,
  verifyZernioSignature,
  whatsappDeliveryMode,
} from "../supabase/functions/_shared/zernio.ts";

test("validates the raw-body HMAC signature", async () => {
  const body = '{"id":"evt-1","event":"message.received"}';
  const secret = "test-webhook-secret";
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(await verifyZernioSignature(body, signature, secret), true);
  assert.equal(await verifyZernioSignature(new TextEncoder().encode(body), signature, secret), true);
  assert.equal(await verifyZernioSignature(`${body} `, signature, secret), false);
  assert.equal(await verifyZernioSignature(body, signature.toUpperCase(), secret), false);
  assert.equal(await verifyZernioSignature(body, null, secret), false);
});

test("deduplicates using matching payload and header event ids", () => {
  assert.equal(eventIdentity({ id: "evt-1" }, "evt-1"), "evt-1");
  assert.equal(eventIdentity({ id: "evt-1" }, null), "evt-1");
  assert.equal(eventIdentity({ id: "evt-1" }, "evt-2"), null);
  assert.equal(duplicateDisposition("pending"), "process");
  assert.equal(duplicateDisposition("failed"), "retry");
  assert.equal(duplicateDisposition("completed"), "skip");
  assert.equal(duplicateDisposition("processing", "2026-10-30T00:00:00.000Z", Date.parse("2026-10-30T00:03:00.000Z")), "retry");
  assert.equal(duplicateDisposition("processing", "2026-10-30T00:00:00.000Z", Date.parse("2026-10-30T00:01:00.000Z")), "skip");
});

test("classifies subscribe, unsubscribe, and help messages", () => {
  assert.equal(inboundCommand("  HELLO there "), "subscribe");
  assert.equal(inboundCommand("Please send ALERTS"), "subscribe");
  assert.equal(inboundCommand("STOP"), "unsubscribe");
  assert.equal(inboundCommand(" unsubscribe "), "unsubscribe");
  assert.equal(inboundCommand("status"), "help");
});

test("selects free-form messaging only inside WhatsApp's 24-hour window", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  assert.equal(insideWhatsAppWindow("2026-10-29T12:00:01.000Z", now), true);
  assert.equal(insideWhatsAppWindow("2026-10-29T12:00:00.000Z", now), false);
  assert.equal(insideWhatsAppWindow("2026-10-30T12:00:01.000Z", now), false);
  assert.equal(insideWhatsAppWindow(null, now), false);
  assert.equal(whatsappDeliveryMode("2026-10-29T12:00:01.000Z", now), "text");
  assert.equal(whatsappDeliveryMode("2026-10-29T12:00:00.000Z", now), "template");
  assert.equal(whatsappDeliveryMode(null, now), "template");
});

test("normalizes WhatsApp senders and accepts inbound directions", () => {
  assert.equal(normalizeE164("+27730884239"), "+27730884239");
  assert.equal(normalizeE164("27730884239"), "+27730884239");
  assert.equal(normalizeE164("not-a-phone"), null);
  assert.equal(isInboundDirection("incoming"), true);
  assert.equal(isInboundDirection("inbound"), true);
  assert.equal(isInboundDirection("outgoing"), false);
});

test("sandbox delivery is restricted to its one activated phone", () => {
  assert.equal(sandboxRecipientAllowed("+27730884239", "27730884239"), true);
  assert.equal(sandboxRecipientAllowed("+27730884239", "+14155550123"), false);
  assert.equal(sandboxRecipientAllowed("invalid", "+27730884239"), false);
});

test("sandbox uses its locked template without alert variables", () => {
  assert.deepEqual(alertTemplateConfig(true, {}), { name: "sandbox_start", language: "en" });
  assert.deepEqual(alertTemplateConfig(false, {}), { name: "alert_notification", language: "en_US" });
  assert.deepEqual(alertTemplateParams(true, "Private alert detail"), []);
  assert.deepEqual(alertTemplateParams(false, "Alert detail"), ["Alert detail"]);
});

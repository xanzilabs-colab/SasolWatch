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
import { buildPlainAirAlert, translateAlertToSesotho } from "../supabase/functions/_shared/alert-language.ts";
import { evaluateSurge, SURGE_MIN_STREAK, SURGE_SCORE_THRESHOLD } from "../lib/surge-score.ts";

test("builds a plain-language alert without sensor jargon", () => {
  const message = buildPlainAirAlert("moderate", "NE");
  assert.match(message, /Air warning for your area/);
  assert.match(message, /spend less time outside/);
  assert.match(message, /wind is coming from the northeast/i);
  assert.match(message, /cannot tell us exactly what is in the air/);
  assert.doesNotMatch(message, /surge score|ADC|MQ|rule score|pollutant concentration/i);
  assert.match(buildPlainAirAlert("severe", "S"), /follow advice from local officials/);
});

test("translates only the plain alert with the configured Gemini key", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), ...init };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Temoso ya moya. Lula ka tlung." }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const translation = await translateAlertToSesotho("Air warning. Stay indoors.", "test-key");
    assert.equal(translation, "Temoso ya moya. Lula ka tlung.");
    assert.match(request.input, /models\/gemini-3\.1-flash-lite:generateContent$/);
    assert.equal(request.headers["x-goog-api-key"], "test-key");
    assert.doesNotMatch(request.input, /test-key/);
    assert.match(JSON.parse(request.body).systemInstruction.parts[0].text, /Sesotho/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails explicitly when Gemini does not return a translation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 });
  try {
    await assert.rejects(translateAlertToSesotho("Air warning.", "test-key"), /empty or oversized translation/);
    await assert.rejects(translateAlertToSesotho("Air warning.", ""), /GEMI_API_KEY is not configured/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a truncated Gemini translation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "Temoso..." }] } }],
  }), { status: 200 });
  try {
    await assert.rejects(translateAlertToSesotho("Air warning.", "test-key"), /translation was truncated/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("requires a sustained, scored sensor rise before opening a surge", () => {
  const base = Date.parse("2026-10-30T07:34:00.000Z");
  const sample = (seconds, gas, baseline = 1355.2) => ({
    ts: new Date(base + seconds * 1000).toISOString(),
    gas_raw: gas,
    baseline_raw: baseline,
  });
  const previous = [sample(0, 1909), sample(1, 2074)];

  const third = evaluateSurge({
    gas: 1817,
    baseline: 1355.2,
    ts: new Date(base + 2000).toISOString(),
    previous,
    warming: false,
    deviceSurge: true,
  });
  assert.equal(third.streak, SURGE_MIN_STREAK);
  assert.equal(third.surge, true);
  assert.ok(third.score >= SURGE_SCORE_THRESHOLD);

  const isolatedSpike = evaluateSurge({
    gas: 2074,
    baseline: 1355.2,
    ts: new Date(base + 1000).toISOString(),
    previous: [],
    warming: false,
    deviceSurge: true,
  });
  assert.equal(isolatedSpike.surge, false);

  const minorPersistentRise = evaluateSurge({
    gas: 1700,
    baseline: 1355.2,
    ts: new Date(base + 2000).toISOString(),
    previous: [sample(0, 1700), sample(1, 1700)],
    warming: false,
    deviceSurge: false,
  });
  assert.equal(minorPersistentRise.surge, false);

  const interruptedRise = evaluateSurge({
    gas: 1817,
    baseline: 1355.2,
    ts: new Date(base + 20_000).toISOString(),
    previous,
    warming: false,
    deviceSurge: true,
  });
  assert.equal(interruptedRise.streak, 1);
  assert.equal(interruptedRise.surge, false);
});

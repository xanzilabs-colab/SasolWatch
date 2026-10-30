// SasolSniff ingest Edge Function (deployed from supabase/functions/ingest).
// Receives ESP32 readings, analyzes sensor response and device wind direction,
// tracks surge events and sends WhatsApp alerts through Zernio.
//
// Deploy:  supabase functions deploy ingest --no-verify-jwt
// Secrets: DEVICE_KEY, ZERNIO_WHATSAPP_API_KEY, ZERNIO_ALERT_TEMPLATE_NAME,
//          ZERNIO_ALERT_TEMPLATE_LANGUAGE, ALERT_DRY_RUN

import { createClient } from "npm:@supabase/supabase-js@2";
import { queueSubscriberAlert, sendQueuedSubscriberAlerts } from "../_shared/zernio.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEVICE_KEY = Deno.env.get("DEVICE_KEY") ?? "";
const ALERT_DRY_RUN = (Deno.env.get("ALERT_DRY_RUN") ?? "true") !== "false";
const ALERT_MIN_SEVERITY = Deno.env.get("ALERT_MIN_SEVERITY") ?? "moderate";
const ALERT_COOLDOWN_MIN = Number(Deno.env.get("ALERT_COOLDOWN_MIN") ?? "10");
const OPENWEATHER_API_KEY = Deno.env.get("OPENWEATHER_API_KEY") ?? Deno.env.get("OPEN_METEO_API_KEY") ?? "";
const WEATHER_TTL_MIN = Number(Deno.env.get("WEATHER_TTL_MIN") ?? "10");

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-device-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- helpers ----------
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const num = (v: unknown, d = 0) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
const norm360 = (d: number) => ((d % 360) + 360) % 360;
const angDiff = (a: number, b: number) => {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
};
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg: number) => COMPASS[Math.round(norm360(deg) / 22.5) % 16];

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return norm360(Math.atan2(y, x) / r);
}
function distKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
function localHourSAST(d: Date) {
  return ((d.getUTCHours() + 2) % 24) + d.getUTCMinutes() / 60;
}
function windSteadiness(degs: number[]) {
  if (!degs.length) return 1;
  const r = degs.map((d) => (d * Math.PI) / 180);
  const x = r.reduce((a, v) => a + Math.cos(v), 0) / r.length;
  const y = r.reduce((a, v) => a + Math.sin(v), 0) / r.length;
  return clamp(Math.hypot(x, y), 0, 1);
}

// ---------- local weather (OpenWeather, cached) ----------
async function getWeather(node: any) {
  try {
    const { data: row } = await sb.from("weather_cache").select("*").eq("node_id", node.id).maybeSingle();
    if (row && Date.now() - new Date(row.fetched_at).getTime() < WEATHER_TTL_MIN * 60_000) return row.data;

    if (!OPENWEATHER_API_KEY) throw new Error("OpenWeather API key is not configured");
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.searchParams.set("lat", String(node.lat));
    url.searchParams.set("lon", String(node.lon));
    url.searchParams.set("units", "metric");
    url.searchParams.set("appid", OPENWEATHER_API_KEY);
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error("openweather " + res.status);
    const j = await res.json();
    if (!j.main || !j.wind) throw new Error("openweather response missing current conditions");
    const precipitation = j.rain?.["1h"] ?? j.rain?.["3h"] ?? 0;
    const data = {
      source: "openweather",
      observed_at: j.dt ? new Date(j.dt * 1000).toISOString() : null,
      temperature_c: j.main.temp,
      humidity_pct: j.main.humidity,
      precipitation_mm: precipitation,
      pressure_hpa: j.main.pressure,
      cloud_cover_pct: j.clouds?.all ?? null,
      wind_speed_ms: j.wind.speed,
      wind_gust_ms: j.wind.gust ?? null,
      wind_dir_deg: j.wind.deg ?? null,
      fetched_at: new Date().toISOString(),
    };
    await sb.from("weather_cache").upsert({ node_id: node.id, fetched_at: data.fetched_at, data });
    return data;
  } catch (e) {
    console.error("weather fetch failed", e instanceof Error ? e.name : "Unknown error");
    const { data: row } = await sb.from("weather_cache").select("data").eq("node_id", node.id).maybeSingle();
    return row?.data ? { ...row.data, stale: true } : null; // fall back to the last good value, or none
  }
}

// ---------- rule-based analysis of measured device readings ----------
const SEVERITY = ["none", "low", "moderate", "high", "severe"];
const SOURCE_LABEL: Record<string, string> = {
  industrial_plume: "industrial plume",
  household_burning: "household coal or wood burning",
  traffic: "traffic",
  open_burning: "open burning or waste",
};
const KIND_TO_TYPE: Record<string, string> = {
  industrial: "industrial_plume",
  power: "industrial_plume",
  mine: "industrial_plume",
  residential: "household_burning",
  road: "traffic",
  waste_treatment: "open_burning",
};
const GUIDANCE: Record<string, string> = {
  none: "Air readings are normal.",
  low: "Slightly elevated readings. No action needed, monitoring continues.",
  moderate: "Reduce outdoor activity and close windows facing the wind direction.",
  high: "Keep children and vulnerable people indoors, close windows, and avoid outdoor exercise.",
  severe: "Stay indoors, wear a mask if you must go out, and cover open water containers. Follow municipal guidance.",
};

function fuse(p: {
  gas: number; baseline: number; warming: boolean; temp: number | null; rh: number | null;
  windFrom: number; ts: Date; prev: any[]; node: any; sources: any[]; weather: any | null;
}) {
  const { gas, baseline, warming, temp, rh, windFrom, ts, prev, node, sources, weather } = p;

  const rise = gas - baseline;
  const threshold = Math.max(150, baseline * 0.25);
  const surge = !warming && rise > threshold;
  const intensity = rise > 0 ? clamp(rise / Math.max(800, 4095 - baseline), 0, 1) : 0;
  let sevRank = 0;
  if (surge) sevRank = intensity < 0.12 ? 1 : intensity < 0.3 ? 2 : intensity < 0.55 ? 3 : 4;

  // onset sharpness from the last few readings
  let slope = 0;
  const ref = prev.length >= 3 ? prev[prev.length - 3] : prev[0];
  if (ref) {
    const dt = (ts.getTime() - new Date(ref.ts).getTime()) / 1000;
    if (dt > 0) slope = Math.max(0, (gas - ref.gas_raw) / dt);
  }
  const sharp = clamp(slope / 40, 0, 1);

  // wind: direction the wind comes FROM; the plume travels toward the opposite direction
  const windHist = [...prev.slice(-5).map((r) => num(r.wind_from_deg, windFrom)), windFrom];
  const steady = windSteadiness(windHist);
  const wsWeather = weather?.wind_speed_ms != null && Number.isFinite(Number(weather.wind_speed_ms))
    ? Number(weather.wind_speed_ms)
    : null;
  const ws = wsWeather;
  const calm = ws != null && ws < 1.5 ? 15 : 0; // light wind: plume direction is less certain, widen the cone
  const halfWidth = Math.round(clamp(60 * (1 - steady) + 15 + calm, 15, 75));
  const windTo = norm360(windFrom + 180);
  const raining = !!weather && num(weather.precipitation_mm, 0) > 0.1;

  // candidate sources inside the upwind sector
  const cands = sources.map((s) => {
    const b = bearingDeg(node.lat, node.lon, s.lat, s.lon);
    const d = distKm(node.lat, node.lon, s.lat, s.lon);
    return { ...s, bearing_deg: Math.round(b), distance_km: Math.round(d * 10) / 10, in_sector: angDiff(b, windFrom) <= halfWidth, off: angDiff(b, windFrom) };
  });
  const inSector = (kinds: string[]) => cands.some((c) => c.in_sector && kinds.includes(c.kind));
  const indIn = inSector(["industrial", "power", "mine"]);
  const resIn = inSector(["residential"]);
  const roadIn = inSector(["road"]);
  const wasteIn = inSector(["waste_treatment"]);

  // source-type scoring from timing, temperature, humidity and what lies upwind
  const hour = localHourSAST(ts);
  const rush = (hour >= 6 && hour < 9) || (hour >= 16 && hour < 18.5) ? 1 : 0;
  const eveMorn = (hour >= 17 && hour < 23) || (hour >= 4 && hour < 8) ? 1 : 0;
  const cold = temp != null && temp < 15 ? 1 : 0;
  const raw: Record<string, number> = {
    industrial_plume: 0.15 + 0.35 * sharp * (indIn ? 1 : 0.5) + 0.3 * (indIn ? 1 : 0) + 0.1 * intensity,
    household_burning: 0.15 + 0.35 * (1 - sharp) * eveMorn + 0.15 * cold + 0.2 * (resIn ? 1 : 0),
    traffic: 0.1 + 0.35 * rush + 0.2 * (roadIn ? 1 : 0) + 0.15 * (1 - sharp),
    open_burning: (0.1 + 0.25 * sharp * (indIn ? 0.4 : 1) + 0.2 * (wasteIn ? 1 : 0) + 0.15 * (rh != null && rh < 50 ? 1 : 0)) * (raining ? 0.7 : 1),
  };
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const scores: Record<string, number> = {};
  for (const k of Object.keys(raw)) scores[k] = Math.round((raw[k] / sum) * 1000) / 1000;
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const sourceType = top[0];
  const confidence = Math.min(0.9, top[1]);

  const candidates = cands
    .filter((c) => c.in_sector)
    .map((c) => {
      const compat = KIND_TO_TYPE[c.kind] === sourceType ? 1 : 0.35;
      const score = 0.5 * compat + 0.3 * clamp(1 - c.distance_km / 10, 0, 1) + 0.2 * clamp(1 - c.off / Math.max(1, halfWidth), 0, 1);
      return {
        id: c.id, name: c.name, kind: c.kind, lat: c.lat, lon: c.lon,
        bearing_deg: c.bearing_deg, distance_km: c.distance_km,
        score: Math.round(score * 100) / 100,
        eta_min: ws == null ? null : Math.round(((c.distance_km * 1000) / Math.max(0.5, ws)) / 60),
        illustrative: c.illustrative,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const rhFactor = rh == null ? 1 : 1 + Math.max(0, rh - 70) / 100;

  const severity = SEVERITY[sevRank];
  return {
    simulated: false,
    method: "rule-based fusion v2 verified sources",
    surge, severity, severity_rank: sevRank,
    intensity: Math.round(intensity * 1000) / 1000,
    rise: Math.round(rise), threshold: Math.round(threshold),
    slope_per_s: Math.round(slope * 10) / 10, sharpness: Math.round(sharp * 100) / 100,
    humidity_factor: Math.round(rhFactor * 100) / 100,
    wind: {
      from_deg: Number(windFrom.toFixed(1)), to_deg: Number(windTo.toFixed(1)),
      compass_from: compass(windFrom), compass_to: compass(windTo),
      steadiness: Math.round(steady * 100) / 100, sector_halfwidth_deg: halfWidth,
      speed_ms: ws == null ? null : Math.round(ws * 10) / 10, speed_assumed: false,
      speed_source: wsWeather === null ? "unavailable" : weather?.source ?? "weather API",
      dir_source: "device potentiometer",
    },
    weather: weather ? {
      ...weather,
      vane_vs_weather_diff_deg: weather.wind_dir_deg != null && Number.isFinite(Number(weather.wind_dir_deg))
        ? Math.round(angDiff(windFrom, Number(weather.wind_dir_deg)))
        : null,
      raining,
    } : null,
    source_type: sourceType, source_label: SOURCE_LABEL[sourceType],
    confidence: Math.round(confidence * 100) / 100, scores,
    candidates, guidance: GUIDANCE[severity],
  };
}

// ---------- Zernio WhatsApp ----------
const cleanParam = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 300);

async function dispatchAlerts(ev: any, fusion: any, node: any, testMode: boolean) {
  const minRank = Math.max(1, SEVERITY.indexOf(ALERT_MIN_SEVERITY));
  if (fusion.severity_rank < minRank || fusion.severity_rank <= (ev.alerted_level ?? 0)) return [];

  const since = new Date(Date.now() - ALERT_COOLDOWN_MIN * 60_000).toISOString();
  const { data: recent } = await sb.from("alerts").select("id").eq("node_id", node.id).gte("created_at", since).limit(1);
  if (recent && recent.length) return []; // cooldown active, retry on a later reading

  const params = [
    cleanParam(node.name),
    cleanParam(fusion.severity.toUpperCase() + (testMode ? " (TEST)" : "")),
    cleanParam("possible " + fusion.source_label),
    cleanParam(fusion.wind.compass_from),
    cleanParam(fusion.guidance),
  ];
  const preview = `SasolSniff air alert for ${params[0]}: ${params[1]} pollution surge detected. Probable source: ${params[2]}. Wind from ${params[3]}. ${params[4]} This is an early-warning estimate, not a confirmed cause.`;

  const { data: subscribers, error: subscribersError } = await sb.from("subscribers")
    .select("id,phone").eq("status", "active");
  if (subscribersError) throw new Error("Could not load active WhatsApp subscribers");

  const dryRun = ALERT_DRY_RUN || testMode;
  const alertRows: Array<Record<string, unknown>> = (subscribers ?? []).map((subscriber: { id: number }) => ({
    event_id: ev.id,
    node_id: node.id,
    subscriber_id: subscriber.id,
    recipient_name: "WhatsApp subscriber",
    channel: "whatsapp",
    status: dryRun ? "dry_run" : "pending",
    severity: fusion.severity,
    message: preview,
  }));
  if (alertRows.length === 0) {
    alertRows.push({
      event_id: ev.id,
      node_id: node.id,
      subscriber_id: null,
      recipient_name: "(no opted-in subscribers)",
      channel: "whatsapp",
      status: "dry_run",
      severity: fusion.severity,
      message: preview,
    });
  }
  const { data: insertedAlerts, error: alertError } = await sb.from("alerts")
    .insert(alertRows).select("id,subscriber_id");
  if (alertError) throw new Error("Could not record WhatsApp alert");

  const alertIdBySubscriber: Record<number, number> = {};
  for (const alert of insertedAlerts ?? []) {
    if (alert.subscriber_id != null) alertIdBySubscriber[alert.subscriber_id] = alert.id;
  }
  try {
    const deliveries = await queueSubscriberAlert(sb, preview, {
      eventId: ev.id,
      severityRank: fusion.severity_rank,
      alertIdBySubscriber,
      dryRun,
    });
    const { error: eventError } = await sb.from("events")
      .update({ alerted_level: fusion.severity_rank, alerted_at: new Date().toISOString() })
      .eq("id", ev.id);
    if (eventError) throw new Error("Could not update alert escalation state");
    if (deliveries.length) EdgeRuntime.waitUntil(sendQueuedSubscriberAlerts(sb, deliveries));
  } catch (error) {
    const alertIds = (insertedAlerts ?? []).map((alert: { id: number }) => alert.id);
    if (alertIds.length) await sb.from("alerts").update({ status: "failed" }).in("id", alertIds);
    throw error;
  }
  return insertedAlerts ?? [];
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!DEVICE_KEY || req.headers.get("x-device-key") !== DEVICE_KEY) return json({ error: "unauthorized" }, 401);

  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const nodeId = String(b.node_id ?? "sasolsniff-node-01").slice(0, 64);
  const gas = Math.round(num(b.gas_raw, NaN));
  if (!Number.isFinite(gas) || gas < 0 || gas > 4095) return json({ error: "gas_raw missing or out of range" }, 400);
  const rawWindFrom = Number(b.wind_from_deg);
  if (b.wind_from_deg == null || !Number.isFinite(rawWindFrom) || rawWindFrom < 0 || rawWindFrom > 360) {
    return json({ error: "wind_from_deg missing or out of range" }, 400);
  }
  const baseline = Number(b.baseline_raw);
  if (!Number.isFinite(baseline) || baseline < 0 || baseline > 4095) {
    return json({ error: "baseline_raw missing or out of range" }, 400);
  }
  const temperature = typeof b.temperature_c === "number" && Number.isFinite(b.temperature_c) && b.temperature_c >= -40 && b.temperature_c <= 80
    ? b.temperature_c
    : null;
  const humidity = typeof b.humidity_pct === "number" && Number.isFinite(b.humidity_pct) && b.humidity_pct >= 0 && b.humidity_pct <= 100
    ? b.humidity_pct
    : null;
  const windRaw = Number(b.wind_raw);
  if (!Number.isInteger(windRaw) || windRaw < 0 || windRaw > 4095) {
    return json({ error: "wind_raw missing or out of range" }, 400);
  }

  const now = new Date();
  let ts = b.ts ? new Date(b.ts) : now;
  if (isNaN(ts.getTime()) || Math.abs(ts.getTime() - now.getTime()) > 10 * 60_000) ts = now;

  // node (auto-register if new)
  let { data: node } = await sb.from("nodes").select("*").eq("id", nodeId).maybeSingle();
  if (!node) {
    const ins = await sb.from("nodes").insert({ id: nodeId, name: nodeId, lat: -26.8167, lon: 27.8167 }).select().single();
    node = ins.data;
  }
  if (!node) return json({ error: "node lookup failed" }, 500);

  const { data: histDesc } = await sb.from("readings")
    .select("ts,gas_raw,wind_from_deg,surge,test_mode").eq("node_id", nodeId).order("ts", { ascending: false }).limit(30);
  const prev = (histDesc ?? []).filter((reading) => !reading.test_mode).slice(0, 12).reverse();
  const { data: sources, error: sourcesError } = await sb.from("sources").select("*").eq("illustrative", false);
  if (sourcesError) return json({ error: "source lookup failed" }, 500);

  const warming = !!b.warming_up;
  const testMode = !!b.test_mode;
  const weather = await getWeather(node);
  const windFrom = norm360(rawWindFrom);
  const fusion = fuse({
    gas, baseline, warming, temp: temperature, rh: humidity,
    windFrom, ts, prev, node, sources: (sources ?? []).filter((source: any) => !source.illustrative), weather,
  });

  // event tracking: open after 2 consecutive surge readings, close after 2 consecutive clear readings
  const prevSurge = !!prev[prev.length - 1]?.surge;
  const { data: openEv } = await sb.from("events").select("*").eq("node_id", nodeId).eq("status", "open")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  let ev: any = openEv;

  if (!ev && fusion.surge && prevSurge) {
    const ins = await sb.from("events").insert({
      node_id: nodeId, started_at: ts.toISOString(), peak_gas_raw: gas, peak_intensity: fusion.intensity,
      severity: fusion.severity, severity_rank: fusion.severity_rank, source_type: fusion.source_type,
      confidence: fusion.confidence, wind_from_deg: windFrom, test_mode: testMode, summary: fusion,
    }).select().single();
    ev = ins.data;
  } else if (ev && fusion.surge) {
    const isPeak = fusion.intensity >= num(ev.peak_intensity, 0);
    const upd: any = { test_mode: ev.test_mode || testMode };
    if (isPeak) {
      Object.assign(upd, {
        peak_gas_raw: gas, peak_intensity: fusion.intensity, source_type: fusion.source_type,
        confidence: fusion.confidence, wind_from_deg: windFrom, summary: fusion,
      });
    }
    if (fusion.severity_rank > num(ev.severity_rank, 0)) {
      upd.severity = fusion.severity;
      upd.severity_rank = fusion.severity_rank;
    }
    const u = await sb.from("events").update(upd).eq("id", ev.id).select().single();
    ev = u.data ?? ev;
  } else if (ev && !fusion.surge && !prevSurge) {
    await sb.from("events").update({ status: "closed", ended_at: ts.toISOString() }).eq("id", ev.id);
    ev = null;
  }

  // store the reading
  const ins = await sb.from("readings").insert({
    node_id: nodeId, ts: ts.toISOString(), gas_raw: gas, baseline_raw: baseline,
    wind_raw: windRaw, wind_from_deg: windFrom,
    temperature_c: temperature, humidity_pct: humidity,
    device_surge: !!b.device_surge, warming_up: warming, test_mode: testMode,
    surge: fusion.surge, event_id: ev?.id ?? null, fusion, rssi: b.rssi ?? null, fw: b.fw ?? null,
  });
  if (ins.error) console.error("reading insert", ins.error);
  await sb.from("nodes").update({ last_seen: now.toISOString() }).eq("id", nodeId);

  // alerts
  let alertRows: any[] = [];
  if (ev && fusion.surge) alertRows = await dispatchAlerts(ev, fusion, node, testMode || !!ev.test_mode);

  return json({
    ok: true, surge: fusion.surge, severity: fusion.severity, event_id: ev?.id ?? null,
    wind_raw: windRaw, wind_from_deg: windFrom, compass_from: compass(windFrom),
    source_type: fusion.source_type, alerts: alertRows.length,
  });
});

// lib/fusion.ts
// SasolSniff fusion engine. This is the SAME logic the Supabase edge function runs.
// The dashboard only uses it for (a) types and (b) the clearly labelled SIMULATOR mode.
// Live data always comes from readings.fusion in Supabase.

// ---------- helpers ----------
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const num = (v: unknown, d = 0) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
export const norm360 = (d: number) => ((d % 360) + 360) % 360;
export const angDiff = (a: number, b: number) => {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
};
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg: number) => COMPASS[Math.round(norm360(deg) / 22.5) % 16];

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return norm360(Math.atan2(y, x) / r);
}
export function distKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
export function localHourSAST(d: Date) {
  return ((d.getUTCHours() + 2) % 24) + d.getUTCMinutes() / 60;
}
export function windSteadiness(degs: number[]) {
  if (!degs.length) return 1;
  const r = degs.map((d) => (d * Math.PI) / 180);
  const x = r.reduce((a, v) => a + Math.cos(v), 0) / r.length;
  const y = r.reduce((a, v) => a + Math.sin(v), 0) / r.length;
  return clamp(Math.hypot(x, y), 0, 1);
}

// ---------- rule-based analysis of measured device readings ----------
export const SEVERITY = ["none", "low", "moderate", "high", "severe"];
export const SOURCE_LABEL: Record<string, string> = {
  industrial_plume: "industrial plume",
  household_burning: "household coal or wood burning",
  traffic: "traffic",
  open_burning: "open burning or waste",
};
export const KIND_TO_TYPE: Record<string, string> = {
  industrial: "industrial_plume",
  power: "industrial_plume",
  mine: "industrial_plume",
  residential: "household_burning",
  road: "traffic",
  waste_treatment: "open_burning",
};
// relative pollutant signature of each source type (0..1)
export const PROFILE: Record<string, Record<string, number>> = {
  industrial_plume: { pm25: 0.4, pm10: 0.3, no2: 0.5, so2: 0.9, h2s: 0.6, co: 0.2, voc: 0.8 },
  household_burning: { pm25: 1.0, pm10: 0.8, no2: 0.2, so2: 0.3, h2s: 0.05, co: 0.9, voc: 0.5 },
  traffic: { pm25: 0.45, pm10: 0.35, no2: 0.9, so2: 0.05, h2s: 0, co: 0.8, voc: 0.5 },
  open_burning: { pm25: 0.9, pm10: 0.8, no2: 0.2, so2: 0.15, h2s: 0.1, co: 0.8, voc: 0.9 },
};
export const BACKGROUND: Record<string, number> = { pm25: 18, pm10: 30, no2: 15, so2: 5, h2s: 1, co: 0.6, voc: 60 };
export const PEAK: Record<string, number> = { pm25: 300, pm10: 450, no2: 250, so2: 400, h2s: 150, co: 40, voc: 1200 };
export const UNIT: Record<string, string> = { pm25: "ug/m3", pm10: "ug/m3", no2: "ug/m3", so2: "ug/m3", h2s: "ug/m3", co: "mg/m3", voc: "ppb" };
export const GUIDANCE: Record<string, string> = {
  none: "Air readings are normal.",
  low: "Slightly elevated readings. No action needed, monitoring continues.",
  moderate: "Reduce outdoor activity and close windows facing the wind direction.",
  high: "Keep children and vulnerable people indoors, close windows, and avoid outdoor exercise.",
  severe: "Stay indoors, wear a mask if you must go out, and cover open water containers. Follow municipal guidance.",
};

export function fuse(p: {
  gas: number; baseline: number; warming: boolean; temp: number | null; rh: number | null;
  windFrom: number; ts: Date; prev: any[]; node: any; sources: any[]; weather: any | null;
  simulated?: boolean;
}) {
  const { gas, baseline, warming, temp, rh, windFrom, ts, prev, node, sources, weather } = p;
  const simulated = p.simulated ?? false;

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
  const ws = wsWeather ?? (simulated ? num(node.default_wind_speed_ms, 3) : null);
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
  const pollutants: Record<string, { value: number; unit: string; simulated: true }> | undefined = simulated ? {} : undefined;
  if (pollutants) {
    for (const k of Object.keys(BACKGROUND)) {
      let mix = 0;
      for (const t of Object.keys(scores)) mix += scores[t] * PROFILE[t][k];
      let v = BACKGROUND[k] + (surge ? intensity : intensity * 0.3) * PEAK[k] * mix;
      if (k === "pm25" || k === "pm10") v = (v / rhFactor) * (raining ? 0.75 : 1);
      pollutants[k] = { value: Math.round(v * 10) / 10, unit: UNIT[k], simulated: true };
    }
  }

  const severity = SEVERITY[sevRank];
  return {
    simulated,
    method: "rule-based fusion v1",
    surge, severity, severity_rank: sevRank,
    intensity: Math.round(intensity * 1000) / 1000,
    rise: Math.round(rise), threshold: Math.round(threshold),
    slope_per_s: Math.round(slope * 10) / 10, sharpness: Math.round(sharp * 100) / 100,
    humidity_factor: Math.round(rhFactor * 100) / 100,
    wind: {
      from_deg: Number(windFrom.toFixed(1)), to_deg: Number(windTo.toFixed(1)),
      compass_from: compass(windFrom), compass_to: compass(windTo),
      steadiness: Math.round(steady * 100) / 100, sector_halfwidth_deg: halfWidth,
      speed_ms: ws == null ? null : Math.round(ws * 10) / 10, speed_assumed: simulated && wsWeather === null,
      speed_source: wsWeather === null ? (simulated ? "simulated default" : "unavailable") : "open-meteo",
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
    candidates,
    ...(pollutants ? { pollutants } : {}),
    guidance: GUIDANCE[severity],
  };
}

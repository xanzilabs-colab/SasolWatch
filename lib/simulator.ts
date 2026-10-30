import { fuse } from "./fusion";
import type { EventRow, Fusion, NodeRow, ReadingRow, SourceRow } from "./types";

export type SimulatorScenario = "industrial_plume" | "household_burning" | "traffic" | "open_burning";

export interface SimulatorSettings {
  scenario: SimulatorScenario;
  intensity: number;
  windFrom: number;
  humidity: number;
  temperature: number;
  rain: boolean;
}

const scenarioTime: Record<SimulatorScenario, [number, number]> = {
  industrial_plume: [12, 0],
  household_burning: [19, 0],
  traffic: [7, 30],
  open_burning: [13, 0],
};

function fakeTimestamp(scenario: SimulatorScenario, tick: number): Date {
  const [sastHour, minute] = scenarioTime[scenario];
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day"), sastHour - 2, minute, tick * 2));
}

export function createSimulatorReading(
  settings: SimulatorSettings,
  tick: number,
  history: ReadingRow[],
  node: NodeRow,
  sources: SourceRow[],
): ReadingRow {
  const baseline = 1500;
  const fast = settings.scenario === "industrial_plume" || settings.scenario === "open_burning";
  const rampSamples = fast ? 3 : 12;
  const cycleLength = rampSamples + 3 + 8 + 4;
  const position = tick % cycleLength;
  const targetRise = 250 + settings.intensity * 2200;
  let ratio = 0;
  if (position < rampSamples) ratio = (position + 1) / rampSamples;
  else if (position < rampSamples + 3) ratio = 1;
  else if (position < rampSamples + 11) ratio = 1 - (position - rampSamples - 2) / 8;
  const gas = Math.round(baseline + targetRise * Math.max(0, ratio));
  const ts = fakeTimestamp(settings.scenario, tick);
  const previous = history.slice(-12).map((reading) => ({
    ts: reading.ts,
    gas_raw: reading.gas_raw,
    baseline_raw: reading.baseline_raw,
    wind_from_deg: reading.wind_from_deg,
    surge: reading.surge,
  }));
  const weather = settings.rain
    ? { precipitation_mm: 0.5, wind_speed_ms: 3.4, wind_dir_deg: settings.windFrom }
    : { precipitation_mm: 0, wind_speed_ms: 3.4, wind_dir_deg: settings.windFrom };
  const fusion = fuse({
    gas,
    baseline,
    warming: false,
    temp: settings.temperature,
    rh: settings.humidity,
    windFrom: settings.windFrom,
    ts,
    prev: previous,
    node,
    sources,
    weather,
    simulated: true,
  }) as Fusion;
  const id = `sim-${tick}`;
  return {
    id,
    node_id: node.id,
    ts: ts.toISOString(),
    received_at: new Date().toISOString(),
    gas_raw: gas,
    baseline_raw: baseline,
    wind_raw: null,
    wind_from_deg: settings.windFrom,
    temperature_c: settings.temperature,
    humidity_pct: settings.humidity,
    device_surge: fusion.surge,
    warming_up: false,
    test_mode: false,
    surge: fusion.surge,
    event_id: null,
    fusion,
    rssi: -53,
    fw: "SIMULATOR",
  };
}

export function simulatorEvent(reading: ReadingRow, startTime: string): EventRow | null {
  const fusion = reading.fusion;
  if (!fusion?.surge) return null;
  return {
    id: "sim-event",
    node_id: reading.node_id,
    status: "open",
    started_at: startTime,
    ended_at: null,
    peak_gas_raw: reading.gas_raw,
    peak_intensity: fusion.intensity,
    severity: fusion.severity,
    severity_rank: fusion.severity_rank,
    source_type: fusion.source_type,
    confidence: fusion.confidence,
    wind_from_deg: fusion.wind.from_deg,
    test_mode: false,
    alerted_level: 0,
    alerted_at: null,
    summary: fusion,
  };
}

export type Severity = "none" | "low" | "moderate" | "high" | "severe";
export type SourceType = "industrial_plume" | "household_burning" | "traffic" | "open_burning";
export type SourceKind = "industrial" | "power" | "mine" | "waste_treatment" | "residential" | "road";

export interface NodeRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  default_wind_speed_ms: number;
  last_seen: string | null;
}

export interface SourceRow {
  id: number;
  name: string;
  kind: SourceKind;
  lat: number;
  lon: number;
  illustrative: boolean;
  note: string | null;
}

export interface WeatherData {
  source?: string;
  observed_at?: string;
  fetched_at?: string;
  temperature_c?: number;
  humidity_pct?: number;
  precipitation_mm?: number;
  pressure_hpa?: number;
  cloud_cover_pct?: number;
  wind_speed_ms?: number;
  wind_gust_ms?: number;
  wind_dir_deg?: number;
  vane_vs_weather_diff_deg?: number | null;
  raining?: boolean;
  stale?: boolean;
}

export interface Candidate {
  id: number | string;
  name: string;
  kind: SourceKind;
  lat: number;
  lon: number;
  bearing_deg: number;
  distance_km: number;
  score: number;
  eta_min: number | null;
  illustrative: boolean;
}

export interface Pollutant {
  value: number;
  unit: string;
  simulated: true;
}

export interface Fusion {
  simulated: boolean;
  method: string;
  surge: boolean;
  severity: Severity;
  severity_rank: number;
  intensity: number;
  rise: number;
  threshold: number;
  slope_per_s: number;
  sharpness: number;
  humidity_factor: number;
  wind: {
    from_deg: number;
    to_deg: number;
    compass_from: string;
    compass_to: string;
    steadiness: number;
    sector_halfwidth_deg: number;
    speed_ms: number | null;
    speed_assumed: boolean;
    speed_source?: string;
    dir_source: string;
  };
  weather: WeatherData | null;
  source_type: SourceType;
  source_label: string;
  confidence: number;
  scores: Record<SourceType, number>;
  candidates: Candidate[];
  pollutants?: Record<"pm25" | "pm10" | "no2" | "so2" | "h2s" | "co" | "voc", Pollutant>;
  guidance: string;
}

export interface ReadingRow {
  id: number | string;
  node_id: string;
  ts: string;
  received_at: string;
  gas_raw: number;
  baseline_raw: number | null;
  wind_raw: number | null;
  wind_from_deg: number | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  device_surge: boolean;
  warming_up: boolean;
  test_mode: boolean;
  surge: boolean;
  event_id: number | null;
  fusion: Fusion | null;
  rssi: number | null;
  fw: string | null;
}

export interface EventRow {
  id: number | string;
  node_id: string;
  status: "open" | "closed";
  started_at: string;
  ended_at: string | null;
  peak_gas_raw: number | null;
  peak_intensity: number;
  severity: Severity;
  severity_rank: number;
  source_type: SourceType | null;
  confidence: number | null;
  wind_from_deg: number | null;
  test_mode: boolean;
  alerted_level: number;
  alerted_at: string | null;
  summary: Fusion | null;
  created_at?: string;
}

export interface AlertRow {
  id: number | string;
  event_id: number | null;
  node_id: string;
  recipient_name: string | null;
  group_type: string | null;
  channel: string;
  status: "sent" | "failed" | "dry_run" | "pending";
  severity: Severity | null;
  message: string | null;
  provider_status: number | null;
  created_at: string;
}

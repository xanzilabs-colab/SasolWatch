"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Copy,
  Cpu,
  Download,
  Factory,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  Map,
  Menu,
  RefreshCw,
  Search,
  Settings,
  SignalZero,
  X,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { AlertsFeed } from "./AlertsFeed";
import { CandidateList } from "./CandidateList";
import { ClassifierPanel } from "./ClassifierPanel";
import { ConditionsCard } from "./ConditionsCard";
import { DemoPlaybook } from "./DemoPlaybook";
import { EventsList } from "./EventsList";
import { Panel } from "./Panel";
import { RealLifeDrawer } from "./RealLifeDrawer";
import { SensorResponse } from "./SensorResponse";
import { SimulatorDrawer } from "./SimulatorDrawer";
import { Timeline } from "./Timeline";
import { WeatherPanel } from "./WeatherPanel";
import { useLiveNode } from "@/lib/useLiveNode";
import { createSimulatorReading, simulatorEvent, type SimulatorSettings } from "@/lib/simulator";
import type { AlertRow, EventRow, Fusion, NodeRow, ReadingRow, SourceKind, SourceRow } from "@/lib/types";
import { compassDirection } from "@/lib/geo";

const PlumeMap = dynamic(() => import("./PlumeMap"), {
  ssr: false,
  loading: () => <div className="map-loading"><Activity size={20} /> Loading live map…</div>,
});

const defaultNode: NodeRow = {
  id: process.env.NEXT_PUBLIC_NODE_ID || "sasolsniff-node-01",
  name: "SasolSniff Node 01",
  lat: -26.8167,
  lon: 27.8167,
  default_wind_speed_ms: 3,
  last_seen: null,
};

const initialSimulatorSettings: SimulatorSettings = {
  scenario: "industrial_plume",
  intensity: 0.65,
  windFrom: 330,
  humidity: 45,
  temperature: 22,
  rain: false,
};

type ViewId = "overview" | "map" | "trends" | "activity" | "sources" | "devices" | "reports" | "guide" | "settings";
type NavigationItem = { id: ViewId; label: string; icon: ComponentType<{ size?: number }> };

const navigationGroups: { label: string; items: NavigationItem[] }[] = [
  { label: "Monitor", items: [
    { id: "overview", label: "Station overview", icon: LayoutDashboard },
    { id: "map", label: "Plume map", icon: Map },
    { id: "trends", label: "Trends", icon: LineChart },
    { id: "activity", label: "Events & alerts", icon: Bell },
  ] },
  { label: "Manage", items: [
    { id: "sources", label: "Source registry", icon: Factory },
    { id: "devices", label: "Devices", icon: Cpu },
    { id: "reports", label: "Reports", icon: FileText },
  ] },
  { label: "Workspace", items: [
    { id: "guide", label: "How it works", icon: BookOpen },
    { id: "settings", label: "Settings", icon: Settings },
  ] },
];

const viewDetails: Record<ViewId, { title: string; description: string }> = {
  overview: { title: "Station overview", description: "Sasolburg, Free State · 26.82°S 27.82°E" },
  map: { title: "Plume map", description: "Node position, registered sources and the estimated upwind sector." },
  trends: { title: "Sensor trends", description: "Review recent gas response, baseline and surge thresholds." },
  activity: { title: "Events & alerts", description: "Review detected events and notification records from this node." },
  sources: { title: "Source registry", description: "Source locations available to the wind-sector analysis." },
  devices: { title: "Devices", description: "Node connectivity, firmware and most recent sensor readings." },
  reports: { title: "Reports", description: "Open event investigation reports or export monitoring data." },
  guide: { title: "How it works", description: "Understand the readings, estimates and limits of this prototype." },
  settings: { title: "Settings", description: "Dashboard connection details and live-data controls." },
};

const pollutantReference: { key: keyof NonNullable<Fusion["pollutants"]>; label: string; limit: number; unit: string }[] = [
  { key: "pm25", label: "PM2.5", limit: 40, unit: "µg/m³" },
  { key: "pm10", label: "PM10", limit: 75, unit: "µg/m³" },
  { key: "no2", label: "NO₂", limit: 200, unit: "µg/m³" },
  { key: "so2", label: "SO₂", limit: 350, unit: "µg/m³" },
  { key: "h2s", label: "H₂S", limit: 150, unit: "µg/m³" },
  { key: "co", label: "CO", limit: 30, unit: "mg/m³" },
  { key: "voc", label: "VOC", limit: 200, unit: "ppb" },
];

const sourceKinds: SourceKind[] = ["industrial", "power", "mine", "waste_treatment", "residential", "road"];

function csvValue(value: unknown) {
  const text = value == null ? "" : String(value);
  const safeText = typeof value === "string" && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return false;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const content = [columns.map(csvValue).join(","), ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function formatSast(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function MetricCard({ label, value, detail, state = "neutral" }: { label: string; value: ReactNode; detail: string; state?: "neutral" | "good" | "warning" | "critical" }) {
  return (
    <article className={`metric-card metric-${state}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ViewHeading({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="view-heading">
      <div><h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="view-actions">{actions}</div>}
    </div>
  );
}

export function Dashboard({
  initialDemoMode,
}: {
  initialDemoMode: boolean;
}) {
  const [now, setNow] = useState(0);
  const [simulatorMode, setSimulatorMode] = useState(false);
  const [simulatorRunning, setSimulatorRunning] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [realLifeOpen, setRealLifeOpen] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceKind, setSourceKind] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [alertFilter, setAlertFilter] = useState("all");
  const [copyMessage, setCopyMessage] = useState("");
  const demoMode = initialDemoMode;
  const [simulatorSettings, setSimulatorSettings] = useState(initialSimulatorSettings);
  const [simulatorReadings, setSimulatorReadings] = useState<ReadingRow[]>([]);
  const [simulatorEvents, setSimulatorEvents] = useState<EventRow[]>([]);
  const [simulatorAlerts, setSimulatorAlerts] = useState<AlertRow[]>([]);
  const simulatorTick = useRef(0);
  const readingsRef = useRef<ReadingRow[]>([]);
  const eventRef = useRef<EventRow | null>(null);
  const generatorRef = useRef<() => void>(() => undefined);
  const live = useLiveNode(!simulatorMode);

  useEffect(() => {
    const firstUpdate = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(firstUpdate);
      window.clearInterval(timer);
    };
  }, []);

  const generateReading = useCallback(() => {
    const node = live.node ?? defaultNode;
    const next = createSimulatorReading(
      simulatorSettings,
      simulatorTick.current,
      readingsRef.current,
      node,
      live.sources,
    );
    const previous = readingsRef.current.at(-1);
    const nextHistory = [...readingsRef.current, next].slice(-300);
    readingsRef.current = nextHistory;
    setSimulatorReadings(nextHistory);
    simulatorTick.current += 1;

    const active = eventRef.current;
    if (next.fusion?.surge) {
      const event = simulatorEvent(next, active?.started_at ?? next.ts);
      if (event) {
        eventRef.current = event;
        setSimulatorEvents((events) => [event, ...events.filter((item) => item.id !== event.id)].slice(0, 10));
        if (!active) {
          setSimulatorAlerts((alerts) => [{
            id: `sim-alert-${next.id}`,
            event_id: null,
            node_id: next.node_id,
            recipient_name: "Demo alert preview",
            group_type: "team",
            channel: "whatsapp",
            status: "dry_run" as const,
            severity: event.severity,
            message: `SasolSniff air alert for ${node.name}: ${event.severity.toUpperCase()} pollution surge detected. Probable source: possible ${event.summary?.source_label}. This is an early-warning estimate, not a confirmed cause.`,
            provider_status: null,
            created_at: next.received_at,
          }, ...alerts].slice(0, 30));
        }
      }
    } else if (active?.status === "open" && !next.fusion?.surge && !previous?.surge) {
      const closed = { ...active, status: "closed" as const, ended_at: next.ts };
      eventRef.current = null;
      setSimulatorEvents((events) => [closed, ...events.filter((item) => item.id !== closed.id)].slice(0, 10));
    }
  }, [live.node, live.sources, simulatorSettings]);

  useEffect(() => {
    generatorRef.current = generateReading;
  }, [generateReading]);

  useEffect(() => {
    if (!simulatorRunning) return;
    generatorRef.current();
    const timer = window.setInterval(() => generatorRef.current(), 2000);
    return () => window.clearInterval(timer);
  }, [simulatorRunning]);

  const node = live.node ?? defaultNode;
  const mapNode = simulatorMode ? node : live.node;
  const readings = simulatorMode ? simulatorReadings : live.readings.filter((reading) => !reading.test_mode);
  const events = simulatorMode ? simulatorEvents : live.events.filter((event) => !event.test_mode);
  const testEventIds = new Set(live.events.filter((event) => event.test_mode).map((event) => event.id));
  const alerts = simulatorMode
    ? simulatorAlerts
    : live.alerts.filter((alert) => alert.event_id == null || !testEventIds.has(alert.event_id));
  const sources: SourceRow[] = live.sources;
  const analysisSources = simulatorMode ? sources : sources.filter((source) => !source.illustrative);
  const latest = readings.at(-1) ?? null;
  const activeEvent = simulatorMode
    ? simulatorEvents.find((event) => event.status === "open") ?? null
    : live.activeEvent?.test_mode ? null : live.activeEvent;
  const fusion = simulatorMode
    ? latest?.fusion ?? activeEvent?.summary ?? null
    : latest?.fusion?.simulated === false && latest.fusion.method === "rule-based fusion v2 verified sources"
      ? latest.fusion
      : activeEvent?.summary?.simulated === false && activeEvent.summary.method === "rule-based fusion v2 verified sources"
        ? activeEvent.summary : null;
  const online = simulatorMode
    ? simulatorRunning && Boolean(latest)
    : Boolean(latest && now > 0 && now - Date.parse(latest.received_at) >= 0 && now - Date.parse(latest.received_at) < 15000);
  const warming = latest?.warming_up ?? false;
  const time = now === 0 ? "--:--:--" : new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
  const severity = fusion?.surge || activeEvent ? fusion?.severity ?? activeEvent?.severity ?? "none" : "none";
  const windFromDeg = simulatorMode
    ? fusion?.wind.from_deg ?? latest?.wind_from_deg ?? null
    : latest?.wind_from_deg ?? null;
  const windFromLabel = windFromDeg == null ? "—" : `${compassDirection(windFromDeg)} ${windFromDeg.toFixed(1)}°`;
  const detail = viewDetails[activeView];
  const ingestUrl = "https://bfcckzvvxqzvctvfrscd.supabase.co/functions/v1/ingest";
  const filteredSources = useMemo(() => sources.filter((source) => {
    const matchesText = `${source.name} ${source.kind} ${source.note ?? ""}`.toLowerCase().includes(sourceSearch.toLowerCase());
    return matchesText && (sourceKind === "all" || source.kind === sourceKind);
  }), [sourceKind, sourceSearch, sources]);
  const filteredEvents = useMemo(() => events.filter((event) =>
    (eventFilter === "all" || event.status === eventFilter) &&
    (severityFilter === "all" || event.severity === severityFilter)
  ), [eventFilter, events, severityFilter]);
  const filteredAlerts = useMemo(() => alerts.filter((alert) => alertFilter === "all" || alert.status === alertFilter), [alertFilter, alerts]);
  const latestReading = latest;
  const indicativeAqi = simulatorMode && fusion?.pollutants ? Math.round(25 + pollutantReference.reduce((maximum, pollutant) => {
    const value = fusion.pollutants?.[pollutant.key]?.value ?? 0;
    return Math.max(maximum, value / pollutant.limit);
  }, 0) * 160) : null;
  const aqiBand = indicativeAqi == null
    ? "Awaiting readings"
    : indicativeAqi > 150 ? "Elevated · indicative"
      : indicativeAqi > 100 ? "Sensitive groups · indicative"
        : indicativeAqi > 50 ? "Moderate · indicative" : "Low · indicative";
  const exportReadings = () => downloadCsv("sasolsniff-readings.csv", readings.map((reading) => ({
    timestamp: reading.ts,
    node_id: reading.node_id,
    gas_raw: reading.gas_raw,
    baseline_raw: reading.baseline_raw,
    wind_from_deg: reading.wind_from_deg,
    temperature_c: reading.temperature_c,
    humidity_pct: reading.humidity_pct,
    rssi: reading.rssi,
    surge: reading.surge,
    warming_up: reading.warming_up,
    test_mode: reading.test_mode,
    severity: reading.fusion?.severity,
    surge_score: reading.fusion?.surge_score,
    surge_streak: reading.fusion?.surge_streak,
    source_hypothesis: reading.fusion?.source_label,
    source_rule_score: reading.fusion?.confidence,
  })));
  const exportEvents = () => downloadCsv("sasolsniff-events.csv", filteredEvents.map((event) => ({
    id: event.id,
    node_id: event.node_id,
    status: event.status,
    started_at: event.started_at,
    ended_at: event.ended_at,
    severity: event.severity,
    peak_gas_raw: event.peak_gas_raw,
    surge_score: event.summary?.surge_score,
    source_hypothesis: event.summary?.source_label,
    source_rule_score: event.confidence,
    test_mode: event.test_mode,
  })));
  const exportAlerts = () => downloadCsv("sasolsniff-alerts.csv", filteredAlerts.map((alert) => ({
    id: alert.id,
    event_id: alert.event_id,
    created_at: alert.created_at,
    status: alert.status,
    severity: alert.severity,
    recipient: alert.recipient_name,
    channel: alert.channel,
    message: alert.message,
  })));
  const copyIngestUrl = async () => {
    try {
      await navigator.clipboard.writeText(ingestUrl);
      setCopyMessage("Ingest URL copied.");
    } catch (error) {
      console.error("Could not copy the ingest URL.", error);
      setCopyMessage("Could not copy automatically. Select and copy the URL above.");
    }
  };
  const navigate = (view: ViewId) => {
    setActiveView(view);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const toggleSimulator = () => {
    if (!simulatorMode) {
      setSimulatorMode(true);
      setSimulatorOpen(true);
      return;
    }
    setSimulatorOpen(true);
  };
  const exitSimulator = () => {
    setSimulatorRunning(false);
    setSimulatorMode(false);
    setSimulatorOpen(false);
    setSimulatorReadings([]);
    setSimulatorEvents([]);
    setSimulatorAlerts([]);
    readingsRef.current = [];
    eventRef.current = null;
    simulatorTick.current = 0;
  };
  const startSimulator = () => {
    setSimulatorMode(true);
    setSimulatorReadings([]);
    setSimulatorEvents([]);
    setSimulatorAlerts([]);
    readingsRef.current = [];
    eventRef.current = null;
    simulatorTick.current = 0;
    setSimulatorRunning(true);
  };
  const stopSimulator = () => setSimulatorRunning(false);
  const polling = !simulatorMode && live.polling;
  const active = Boolean(fusion?.surge || latest?.surge || activeEvent);
  const canExportReadings = readings.length > 0;
  const headerStatus = simulatorMode
    ? simulatorRunning ? "Simulator running" : "Simulator paused"
    : online ? "Station online" : latest ? "Data stale" : "Station offline";
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseConnected = Boolean(projectUrl && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const pollutantTable = simulatorMode ? (
    <Panel title="Pollutant estimates" eyebrow="INDICATIVE AIR PROFILE" simulated={Boolean(fusion?.pollutants)}>
      <p className="table-caption">Estimates are derived from sensor response; they are not direct pollutant measurements. Reference values are comparison guides, not an official AQI.</p>
      <div className="table-scroll">
        <table className="data-table pollutant-table">
          <thead><tr><th>Pollutant</th><th className="numeric-cell">Estimate</th><th className="numeric-cell">Reference</th><th>Share of reference</th><th>Status</th></tr></thead>
          <tbody>
            {pollutantReference.map((pollutant) => {
              const item = fusion?.pollutants?.[pollutant.key];
              const value = item?.value ?? null;
              const ratio = value == null ? 0 : value / pollutant.limit;
              const share = Math.round(ratio * 100);
              return (
                <tr key={pollutant.key}>
                  <td><strong>{pollutant.label}</strong></td>
                  <td className="numeric-cell mono">{value == null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${item?.unit ?? pollutant.unit}`}</td>
                  <td className="numeric-cell mono">{pollutant.limit} <small>{pollutant.unit}</small></td>
                  <td><div className="reference-progress"><span className={share >= 100 ? "progress-critical" : share >= 60 ? "progress-warning" : ""} style={{ width: `${Math.min(100, share)}%` }} /></div><small className="reference-share">{value == null ? "No reading" : `${share}%`}</small></td>
                  <td><span className={`table-status ${value == null ? "" : share >= 100 ? "table-status-critical" : share >= 60 ? "table-status-warning" : "table-status-good"}`}>{value == null ? "No data" : share >= 100 ? "Above reference" : share >= 60 ? "Elevated" : "Within reference"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  ) : (
    <Panel title="Measured device inputs" eyebrow="DIRECT SENSOR DATA">
      <p className="table-caption">These are the latest values received from your ESP32. This hardware does not measure individual pollutant concentrations or an AQI.</p>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Measurement</th><th>Latest device value</th><th>Input</th></tr></thead>
          <tbody>
            <tr><td><strong>Gas sensor response</strong></td><td className="mono">{latest?.gas_raw.toLocaleString() ?? "—"} ADC counts</td><td>MQ analog sensor · GPIO 34</td></tr>
            <tr><td><strong>Clean-air baseline</strong></td><td className="mono">{latest?.baseline_raw?.toLocaleString() ?? "—"} ADC counts</td><td>Measured by device firmware</td></tr>
            <tr><td><strong>Wind from</strong></td><td className="mono">{windFromLabel}</td><td>Potentiometer · raw ADC {latest?.wind_raw ?? "—"} / 4095</td></tr>
            <tr><td><strong>Temperature</strong></td><td className="mono">{latest?.temperature_c == null ? "—" : `${latest.temperature_c.toFixed(1)} °C`}</td><td>DHT11 on node</td></tr>
            <tr><td><strong>Humidity</strong></td><td className="mono">{latest?.humidity_pct == null ? "—" : `${latest.humidity_pct.toFixed(1)}%`}</td><td>DHT11 on node</td></tr>
            <tr><td><strong>Wi-Fi signal</strong></td><td className="mono">{latest?.rssi == null ? "—" : `${latest.rssi} dBm`}</td><td>ESP32-reported RSSI</td></tr>
          </tbody>
        </table>
      </div>
      <p className="data-caveat">The MQ sensor reports a raw response, not calibrated gas concentration. No PM2.5, PM10, NO₂, SO₂, H₂S, CO or VOC level is measured by this hardware.</p>
    </Panel>
  );

  const overviewContent = (
    <>
      {online && (fusion?.surge || activeEvent) ? (
        <div className={`station-notice notice-${severity}`}>
          <AlertTriangle size={18} />
          <div><strong>{activeEvent ? "Sustained sensor-response event" : "Elevated sensor response"}</strong><span>{fusion?.guidance ?? "Review the wind sector and readings; this estimate is not confirmed source attribution."}</span></div>
        </div>
      ) : latest && !online && !simulatorMode ? (
        <div className="station-notice notice-warning"><SignalZero size={18} /><div><strong>Last device reading is stale</strong><span>Showing the last sensor data received at {formatSast(latest.received_at)}. No update has arrived in the last 15 seconds; this is stored device data, not a live reading.</span></div><button className="toolbar-button" onClick={() => void live.refresh()}><RefreshCw size={14} /> Retry</button></div>
      ) : live.error && !simulatorMode ? (
        <div className="station-notice notice-warning"><AlertTriangle size={18} /><div><strong>Dashboard data is unavailable.</strong><span>{live.error}</span></div><button className="toolbar-button" onClick={() => void live.refresh()}><RefreshCw size={14} /> Retry</button></div>
      ) : !online && !simulatorMode ? (
        <div className="station-notice notice-neutral"><SignalZero size={18} /><div><strong>Station offline</strong><span>{live.loading ? "Connecting to Supabase…" : "No device readings received. Check device power and Wi-Fi, or run the simulator to preview the dashboard."}</span></div></div>
      ) : (
        <div className={`station-notice ${simulatorMode ? "notice-warning" : "notice-good"}`}>
          <Activity size={18} /><div><strong>{simulatorMode ? "Simulator data — not from device" : warming ? "Sensor warming up" : "Monitoring station is online"}</strong><span>{simulatorMode ? "These readings are generated locally and are never written to Supabase." : `Latest reading received ${formatSast(latest?.received_at)}.`}</span></div>
        </div>
      )}
      {demoMode && <DemoPlaybook latest={simulatorMode ? null : latest} />}
      <section className="status-strip" aria-label="Station summary">
        <MetricCard label="Station" value={online ? "Online" : simulatorMode ? "Simulator" : latest ? "Stale" : "Offline"} detail={`${node.name} · Sasolburg`} state={online ? "good" : latest ? "warning" : "neutral"} />
        {simulatorMode
          ? <MetricCard label="Indicative AQI · simulated" value={indicativeAqi ?? "—"} detail={aqiBand} state={indicativeAqi == null ? "neutral" : indicativeAqi >= 100 ? "warning" : "good"} />
          : <MetricCard label="Wind potentiometer" value={latest?.wind_raw ?? "—"} detail="Raw ADC · expected range 0–4095" />}
        <MetricCard label="Gas response" value={<>{latestReading?.gas_raw.toLocaleString() ?? "—"}<small> raw</small></>} detail={fusion ? `Rise ${Math.round(fusion.rise)} · threshold ${Math.round(fusion.threshold)}` : "Awaiting sensor data"} state={fusion?.surge ? "critical" : latestReading ? "good" : "neutral"} />
        <MetricCard label="Surge score" value={fusion?.surge_score == null ? "—" : `${fusion.surge_score}/100`} detail={fusion?.surge_score == null ? "Awaiting scored sensor reading" : `${Math.min(fusion.surge_streak ?? 0, 3)}/3 consecutive · trigger ${fusion.surge_score_threshold ?? 60}`} state={fusion?.surge ? "critical" : fusion?.surge_score != null && fusion.surge_score >= (fusion.surge_score_threshold ?? 60) ? "warning" : "neutral"} />
        <MetricCard label="Wind · from" value={windFromLabel} detail={simulatorMode ? "Local scenario direction" : latest?.wind_raw == null ? "Waiting for potentiometer ADC" : `Device potentiometer · ADC ${latest.wind_raw}`} />
        <MetricCard label="Upwind sector" value={active && fusion && windFromDeg != null ? `${compassDirection(windFromDeg)} ±${fusion.wind.sector_halfwidth_deg}°` : "—"} detail={active ? "Screening sector from device wind direction" : "No active surge"} state={active ? "warning" : "neutral"} />
        <MetricCard label="Events · alerts" value={`${events.length} · ${alerts.length}`} detail="Recorded for this node" state={alerts.length ? "warning" : "neutral"} />
      </section>

      <div className="content-grid overview-map-grid">
        <section className="span-8"><PlumeMap node={mapNode} sources={analysisSources} fusion={fusion} simulator={simulatorMode} windFromDeg={windFromDeg} windRaw={simulatorMode ? null : latest?.wind_raw ?? null} readingTime={latest?.received_at ?? null} /></section>
        <div className="content-stack span-4">
          <ClassifierPanel fusion={fusion} active={active} simulated={simulatorMode} reading={latest} />
          <CandidateList fusion={fusion} active={active} simulated={simulatorMode} sourceCount={analysisSources.length} />
        </div>
      </div>
      <div className="content-grid">
        <section className="span-7">{pollutantTable}</section>
        <div className="content-stack span-5">
          <WeatherPanel fusion={fusion} node={node} simulated={simulatorMode} deviceWindFrom={windFromDeg} />
          <ConditionsCard latest={latest} simulated={simulatorMode} />
        </div>
      </div>
      <div className="content-grid">
        <section className="span-12"><Timeline readings={readings} events={events} alerts={alerts} simulated={simulatorMode} /></section>
      </div>
      <div className="content-grid">
        <section className="span-7">
          <EventsList events={events.slice(0, 5)} simulated={simulatorMode} now={now} />
          <button className="text-action" onClick={() => navigate("activity")}>View all events <ChevronRight size={14} /></button>
        </section>
        <section className="span-5">
          <AlertsFeed alerts={alerts.slice(0, 5)} simulated={simulatorMode} />
          <button className="text-action" onClick={() => navigate("activity")}>View all alerts <ChevronRight size={14} /></button>
        </section>
      </div>
    </>
  );

  const currentView = (() => {
    switch (activeView) {
      case "overview":
        return overviewContent;
      case "map":
        return (
          <div className="content-grid map-view-grid">
            <section className="span-8"><PlumeMap node={mapNode} sources={analysisSources} fusion={fusion} simulator={simulatorMode} windFromDeg={windFromDeg} windRaw={simulatorMode ? null : latest?.wind_raw ?? null} readingTime={latest?.received_at ?? null} /></section>
            <div className="content-stack span-4">
              <ClassifierPanel fusion={fusion} active={active} simulated={simulatorMode} reading={latest} />
              <CandidateList fusion={fusion} active={active} simulated={simulatorMode} sourceCount={analysisSources.length} />
              <WeatherPanel fusion={fusion} node={node} simulated={simulatorMode} deviceWindFrom={windFromDeg} />
            </div>
          </div>
        );
      case "trends":
        return (
          <>
            <div className="content-grid"><section className="span-12"><Timeline readings={readings} events={events} alerts={alerts} simulated={simulatorMode} /></section></div>
            <div className="content-grid">
              <section className="span-5"><SensorResponse readings={readings} latest={latest} simulated={simulatorMode} /></section>
              <section className="span-7">{pollutantTable}</section>
            </div>
            <div className="content-grid">
              <section className="span-6"><ConditionsCard latest={latest} simulated={simulatorMode} /></section>
              <section className="span-6"><WeatherPanel fusion={fusion} node={node} simulated={simulatorMode} deviceWindFrom={windFromDeg} /></section>
            </div>
          </>
        );
      case "activity":
        return (
          <>
            <div className="filter-toolbar">
              <label><span>Event status</span><select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}><option value="all">All events</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
              <label><span>Severity</span><select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value="all">All severities</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option><option value="severe">Severe</option></select></label>
              <label><span>Alert status</span><select value={alertFilter} onChange={(event) => setAlertFilter(event.target.value)}><option value="all">All alerts</option><option value="pending">Pending</option><option value="sent">Sent</option><option value="dry_run">Preview</option><option value="failed">Failed</option></select></label>
              <span className="filter-count">{filteredEvents.length} events · {filteredAlerts.length} alerts</span>
            </div>
            <div className="content-grid">
              <section className="span-7"><EventsList events={filteredEvents} simulated={simulatorMode} now={now} /></section>
              <section className="span-5"><AlertsFeed alerts={filteredAlerts} simulated={simulatorMode} /></section>
            </div>
            <div className="content-grid"><section className="span-12"><Timeline readings={readings} events={filteredEvents} alerts={filteredAlerts} simulated={simulatorMode} /></section></div>
          </>
        );
      case "sources":
        return (
          <Panel title="Registered source locations" eyebrow="SOURCE REGISTRY" action={<span className="record-count">{filteredSources.length} of {sources.length}</span>}>
            <p className="table-caption">These locations are used to estimate possible upwind candidates. Illustrative locations are not verified facility boundaries or proof of emissions.</p>
            <div className="registry-toolbar">
              <label className="search-control"><Search size={16} /><input type="search" value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="Search name or note" aria-label="Search source registry" /></label>
              <label className="select-control"><span>Type</span><select value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}><option value="all">All types</option>{sourceKinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select></label>
            </div>
            <div className="table-scroll"><table className="data-table">
              <thead><tr><th>Source</th><th>Type</th><th>Coordinates</th><th>Classification</th><th>Notes</th></tr></thead>
              <tbody>{filteredSources.map((source) => <tr key={source.id}><td><strong>{source.name}</strong></td><td className="capitalize">{source.kind.replaceAll("_", " ")}</td><td className="mono">{source.lat.toFixed(4)}, {source.lon.toFixed(4)}</td><td><span className={`table-status ${source.illustrative ? "table-status-warning" : "table-status-good"}`}>{source.illustrative ? "Illustrative" : "Verified record"}</span></td><td>{source.note || "—"}</td></tr>)}</tbody>
            </table></div>
            {!filteredSources.length && <div className="empty-panel">{sources.length ? "No sources match those filters." : "No source locations are available. Apply the project's schema seed or add approved source data to Supabase."}</div>}
          </Panel>
        );
      case "devices":
        return (
          <>
            <div className="status-strip device-status-strip">
              <MetricCard label="Connection" value={online ? "Connected" : simulatorMode ? "Simulator" : latest ? "Stale" : "Offline"} detail={simulatorMode ? "Local simulator" : online ? "Latest reading is current" : latest ? "Last device reading is older than 15 seconds" : "No device reading received"} state={online ? "good" : latest ? "warning" : "neutral"} />
              <MetricCard label="Last reading" value={latest ? formatSast(latest.received_at) : "—"} detail="South Africa Standard Time" />
              <MetricCard label="Firmware" value={latest?.fw ?? "—"} detail={latest ? "Reported by device" : "No firmware report"} />
              <MetricCard label="Wi-Fi signal" value={latest?.rssi == null ? "—" : `${latest.rssi} dBm`} detail={latest?.rssi == null ? "No signal data received" : "Reported by device"} />
            </div>
            <div className="content-grid">
              <section className="span-7"><Panel title={node.name} eyebrow="REGISTERED SENSOR NODE">
                <div className="detail-list">
                  <div><span>Node ID</span><strong className="mono">{node.id}</strong></div>
                  <div><span>Location</span><strong>Sasolburg, Free State</strong></div>
                  <div><span>Coordinates</span><strong className="mono">{node.lat.toFixed(4)}, {node.lon.toFixed(4)}</strong></div>
                  <div><span>Last device contact</span><strong>{formatSast(latest?.received_at ?? node.last_seen)}</strong></div>
                  <div><span>Sensor warm-up</span><strong>{latest ? latest.warming_up ? "In progress" : "Complete" : "No reading yet"}</strong></div>
                  <div><span>Wind potentiometer ADC</span><strong className="mono">{latest?.wind_raw == null ? "No reading" : `${latest.wind_raw} / 4095`}</strong></div>
                  <div><span>Wind direction from device</span><strong>{windFromLabel}</strong></div>
                </div>
              </Panel></section>
              <section className="span-5"><ConditionsCard latest={latest} simulated={simulatorMode} /></section>
            </div>
            <Panel title="Connect or troubleshoot the ESP32" eyebrow="DEVICE INGEST">
              <p className="section-description">The device sends a reading every few seconds to this Supabase Edge Function. Keep the device key private and make sure its value matches the Supabase <code>DEVICE_KEY</code> secret.</p>
              <div className="copy-endpoint"><code>{ingestUrl}</code><button className="toolbar-button" onClick={() => void copyIngestUrl()}><Copy size={14} /> Copy URL</button></div>
              {copyMessage && <p className="copy-feedback" role="status">{copyMessage}</p>}
              <ol className="setup-steps"><li>Connect the ESP32 to a 2.4 GHz Wi-Fi network.</li><li>Set the ingest URL, node ID, Wi-Fi credentials and matching device key in the firmware.</li><li>Upload the sketch; confirm the serial monitor reports a successful HTTP response.</li><li>Check Supabase <strong>readings</strong> and return here to confirm the node is online.</li></ol>
              <p className="data-caveat">Do not paste Wi-Fi passwords, device keys or Supabase service-role keys into chat or commit them to source control.</p>
            </Panel>
          </>
        );
      case "reports":
        return (
          <>
            <div className="report-actions-grid">
              <button className="report-action-card" onClick={exportReadings} disabled={!readings.length}><Download size={18} /><strong>Readings CSV</strong><span>Export {readings.length} loaded sensor readings</span></button>
              <button className="report-action-card" onClick={exportEvents} disabled={!filteredEvents.length}><FileText size={18} /><strong>Events CSV</strong><span>Export {filteredEvents.length} event records</span></button>
              <button className="report-action-card" onClick={exportAlerts} disabled={!filteredAlerts.length}><Bell size={18} /><strong>Alerts CSV</strong><span>Export {filteredAlerts.length} notification records</span></button>
              <button className="report-action-card" onClick={() => window.print()}><FileText size={18} /><strong>Print this page</strong><span>Print or save the current report view as PDF</span></button>
            </div>
            <Panel title="Event investigation reports" eyebrow="REPORT ARCHIVE" action={<span className="record-count">{events.length} records</span>}>
              <p className="table-caption">Open an event report for its readings, wind conditions and source estimate. Reports distinguish measured values from modelled estimates.</p>
              <EventsList events={events} simulated={simulatorMode} now={now} />
            </Panel>
          </>
        );
      case "guide":
        return (
          <>
            <div className="guide-callout"><Activity size={20} /><div><strong>Screening and early warning—not proof of a pollution source.</strong><p>Use this prototype to spot changing sensor response and prioritize investigation. Confirm incidents with calibrated instruments and qualified responders.</p></div><button className="toolbar-button" onClick={() => setRealLifeOpen(true)}><CircleHelp size={14} /> Open full guide</button></div>
            <div className="guide-grid">
              {[
                ["01", "Sensor node", "The ESP32 reports gas-sensor response, temperature, humidity, wind-vane direction and signal strength."],
                ["02", "Data and weather", "Supabase stores the ESP32 readings. OpenWeather conditions are shown separately; wind direction always comes from the device potentiometer."],
                ["03", "Surge detection", "Rules compare gas response to a clean-air baseline and look at the change over time."],
                ["04", "Wind-sector analysis", "When a surge is detected, the dashboard checks illustrative registered source locations in the upwind sector."],
                ["05", "Estimates and alerts", "Live mode shows no invented pollutant concentrations or AQI. The optional simulator is local and starts only when you choose it. Notification records may be previews; inspect their status."],
                ["06", "Investigation", "Review the timeline and event report, then verify potential incidents using official monitoring equipment."],
              ].map(([number, title, copy]) => <article className="guide-step" key={number}><span>{number}</span><div><h2>{title}</h2><p>{copy}</p></div></article>)}
            </div>
            <div className="data-caveat">Prototype limits: low-cost gas sensor readings do not identify a chemical; estimated pollutant values are not measurements; mapped source positions remain illustrative unless verified.</div>
          </>
        );
      case "settings":
        return (
          <>
            <div className="content-grid">
              <section className="span-7"><Panel title="Dashboard connection" eyebrow="SUPABASE">
                <div className="detail-list">
                  <div><span>Connection status</span><strong className={supabaseConnected ? "text-good" : "text-warning"}>{supabaseConnected ? "Configured" : "Not configured"}</strong></div>
                  <div><span>Project URL</span><strong className="mono">{projectUrl || "Add NEXT_PUBLIC_SUPABASE_URL to .env.local"}</strong></div>
                  <div><span>Node ID</span><strong className="mono">{node.id}</strong></div>
                  <div><span>Data transport</span><strong>Realtime with 4-second polling fallback</strong></div>
                  <div><span>Browser access</span><strong>Read-only · public anon key · no login</strong></div>
                </div>
                <p className="data-caveat">The browser never displays or uses the device key or Supabase service-role key. Device authentication is handled by the Edge Function.</p>
              </Panel></section>
              <section className="span-5"><Panel title="Live data controls" eyebrow="MONITORING">
                <p className="section-description">Refresh the latest node, readings, source locations, events and alert records from Supabase.</p>
                <button className="toolbar-button settings-refresh" disabled={live.loading || simulatorMode} onClick={() => void live.refresh()}><RefreshCw size={15} /> {live.loading ? "Loading…" : simulatorMode ? "Exit simulator to refresh live data" : "Refresh live data"}</button>
                <button className="toolbar-button" onClick={toggleSimulator}><FlaskConical size={15} /> Open simulator</button>
                {live.error && !simulatorMode && <p className="copy-feedback" role="alert">{live.error}</p>}
              </Panel></section>
            </div>
            <Panel title="Prototype data and privacy" eyebrow="IMPORTANT">
              <ul className="settings-notes"><li>Candidate locations are illustrative until replaced with verified facility data.</li><li>Pollutant values are estimates derived from sensor response, not direct pollutant measurements.</li><li>Simulator readings stay in this browser session and are never submitted to Supabase.</li><li>Never share or commit your Wi-Fi password, <code>DEVICE_KEY</code>, or service-role key.</li></ul>
            </Panel>
          </>
        );
    }
  })();

  return (
    <div className={`app-frame ${online && (fusion?.surge || activeEvent) ? `surge-glow severity-${severity}` : ""} ${simulatorMode ? "simulator-active" : ""}`}>
      {mobileNavOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <header className="app-topbar">
        <button className="mobile-menu-button" aria-label="Toggle navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X size={19} /> : <Menu size={19} />}</button>
        <div className="reference-brand"><span className="reference-brand-mark"><Activity size={18} /></span><span><strong>SasolSniff</strong><small>AIR QUALITY MONITORING</small></span></div>
        <div className="reference-crumbs"><span>Vaal Triangle</span><ChevronRight size={14} /><span>Sasolburg</span><ChevronRight size={14} /><strong>{node.name}</strong></div>
        <div className="topbar-spacer" />
        <div className="header-station-status"><span className={`connection-dot ${online || simulatorMode ? "connection-good" : ""}`} /><span>{headerStatus}</span>{polling && <small>Polling</small>}</div>
        <time className="header-clock">{time} SAST</time>
        <button className="header-button" onClick={() => setRealLifeOpen(true)}><CircleHelp size={15} /> <span>Guide</span></button>
        <button className="header-button header-button-primary" onClick={toggleSimulator}><FlaskConical size={15} /> <span>{simulatorMode ? "Simulator" : "Run scenario"}</span></button>
      </header>

      <div className="app-shell">
        <aside className={`app-sidebar ${mobileNavOpen ? "sidebar-open" : ""}`} aria-label="Main navigation">
          <nav>
            {navigationGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <h2>{group.label}</h2>
                {group.items.map(({ id, label, icon: Icon }) => (
                  <button className={`nav-item ${activeView === id ? "nav-item-active" : ""}`} key={id} onClick={() => navigate(id)} aria-current={activeView === id ? "page" : undefined}>
                    <Icon size={17} /><span>{label}</span>{id === "activity" && events.some((event) => event.status === "open") && <i className="nav-alert-dot" />}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom"><span>PROTOTYPE BUILD</span><strong>{node.name}</strong><small>Low-cost sensor · screening use</small></div>
        </aside>

        <main className="workspace-main">
          <ViewHeading
            title={detail.title}
            description={activeView === "overview" ? `${detail.description} · Last updated ${formatSast(latest?.received_at)}` : detail.description}
            actions={<>
              <button className="toolbar-button" onClick={exportReadings} disabled={!canExportReadings}><Download size={15} /> <span>Export readings</span></button>
              <button className="toolbar-button toolbar-primary" onClick={toggleSimulator}><FlaskConical size={15} /> <span>{simulatorMode ? "Scenario controls" : "Run scenario"}</span></button>
            </>}
          />
          {live.error && !simulatorMode && activeView !== "overview" && activeView !== "settings" && (
            <div className="station-notice notice-high"><AlertTriangle size={18} /><div><strong>Dashboard data is unavailable.</strong><span>{live.error}</span></div><button className="toolbar-button" onClick={() => void live.refresh()}><RefreshCw size={14} /> Retry</button></div>
          )}
          {currentView}
          <footer className="workspace-footer">
            <span>SasolSniff prototype · Screening and early warning complement, not replace, official monitoring.</span>
            {live.loading && !simulatorMode && <span className="footer-connection"><i /> Updating from Supabase…</span>}
          </footer>
        </main>
      </div>

      <RealLifeDrawer open={realLifeOpen} onClose={() => setRealLifeOpen(false)} />
      <SimulatorDrawer
        open={simulatorOpen}
        running={simulatorRunning}
        settings={simulatorSettings}
        onSettings={setSimulatorSettings}
        onStart={startSimulator}
        onStop={stopSimulator}
        onExit={exitSimulator}
        onClose={() => setSimulatorOpen(false)}
      />
    </div>
  );
}

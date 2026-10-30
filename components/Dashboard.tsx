"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, CircleHelp, FlaskConical, RefreshCw } from "lucide-react";
import { AlertsFeed } from "./AlertsFeed";
import { CandidateList } from "./CandidateList";
import { ClassifierPanel } from "./ClassifierPanel";
import { ConditionsCard } from "./ConditionsCard";
import { DemoPlaybook } from "./DemoPlaybook";
import { EventBanner } from "./EventBanner";
import { EventsList } from "./EventsList";
import { PollutantBars } from "./PollutantBars";
import { RealLifeDrawer } from "./RealLifeDrawer";
import { SensorResponse } from "./SensorResponse";
import { SimulatorDrawer } from "./SimulatorDrawer";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";
import { WeatherPanel } from "./WeatherPanel";
import { useLiveNode } from "@/lib/useLiveNode";
import { createSimulatorReading, simulatorEvent, type SimulatorSettings } from "@/lib/simulator";
import type { AlertRow, EventRow, NodeRow, ReadingRow, SourceRow } from "@/lib/types";

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

export function Dashboard({
  initialDemoMode,
  initialSimulatorMode,
}: {
  initialDemoMode: boolean;
  initialSimulatorMode: boolean;
}) {
  const [now, setNow] = useState(0);
  const [simulatorMode, setSimulatorMode] = useState(initialSimulatorMode);
  const [simulatorRunning, setSimulatorRunning] = useState(initialSimulatorMode);
  const [simulatorOpen, setSimulatorOpen] = useState(initialSimulatorMode);
  const [realLifeOpen, setRealLifeOpen] = useState(false);
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
    if (next.fusion?.surge && (active?.status === "open" || previous?.surge)) {
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
  const readings = simulatorMode ? simulatorReadings : live.readings;
  const events = simulatorMode ? simulatorEvents : live.events;
  const alerts = simulatorMode ? simulatorAlerts : live.alerts;
  const sources: SourceRow[] = live.sources;
  const latest = readings.at(-1) ?? null;
  const activeEvent = simulatorMode
    ? simulatorEvents.find((event) => event.status === "open") ?? null
    : live.activeEvent;
  const fusion = latest?.fusion ?? activeEvent?.summary ?? null;
  const online = simulatorMode
    ? simulatorRunning && Boolean(latest)
    : Boolean(latest && now - Date.parse(latest.received_at) < 15000);
  const warming = latest?.warming_up ?? false;
  const testMode = latest?.test_mode ?? activeEvent?.test_mode ?? false;
  const time = now === 0 ? "--:--:--" : new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
  const severity = fusion?.surge || activeEvent ? fusion?.severity ?? activeEvent?.severity ?? "none" : "none";
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
  const statusText = !simulatorMode && !online && !live.loading
    ? "Waiting for the device. Check power and Wi-Fi."
    : null;

  return (
    <main className={`dashboard-shell ${fusion?.surge || activeEvent ? `surge-glow severity-${severity}` : ""} ${simulatorMode ? "simulator-active" : ""}`}>
      <TopBar
        node={node}
        latest={latest}
        online={online}
        warming={warming}
        testMode={testMode}
        simulator={simulatorMode}
        severity={severity}
        polling={polling}
        time={time}
      />
      {fusion && <EventBanner fusion={fusion} event={activeEvent} now={now} />}
      {live.error && !simulatorMode && <div className="inline-error"><strong>Dashboard data is unavailable.</strong><span>{live.error}</span><button onClick={() => void live.refresh()}><RefreshCw size={13} /> Retry</button></div>}
      {statusText && !simulatorMode && <div className="offline-notice"><span className="offline-dot" />{statusText}</div>}
      {demoMode && <DemoPlaybook latest={simulatorMode ? null : latest} />}

      <div className="dashboard-grid">
        <aside className="dashboard-column left-column">
          <SensorResponse readings={readings} latest={latest} simulated={simulatorMode} />
          <PollutantBars fusion={fusion} simulated={simulatorMode} />
          <ConditionsCard latest={latest} simulated={simulatorMode} />
        </aside>
        <section className="dashboard-column map-column">
          <PlumeMap node={node} sources={sources} fusion={fusion} simulator={simulatorMode} />
        </section>
        <aside className="dashboard-column analysis-column">
          <ClassifierPanel fusion={fusion} active={Boolean(fusion?.surge || activeEvent)} simulated={simulatorMode} readingTime={latest?.ts} />
          <CandidateList fusion={fusion} active={Boolean(fusion?.surge || activeEvent)} simulated={simulatorMode} sourceCount={sources.length} />
          <WeatherPanel fusion={fusion} node={node} simulated={simulatorMode} />
          <AlertsFeed alerts={alerts} simulated={simulatorMode} />
          <EventsList events={events} simulated={simulatorMode} now={now} />
        </aside>
        <section className="dashboard-bottom">
          <Timeline readings={readings} events={events} alerts={alerts} simulated={simulatorMode} />
        </section>
      </div>

      <footer className="dashboard-footer">
        <span>SasolSniff prototype. Low-cost sensors screen for investigation and complement official monitoring stations.</span>
        {live.loading && !simulatorMode && <span className="loading-indicator"><i /> Connecting to Supabase…</span>}
      </footer>

      <div className="floating-actions">
        <button className="secondary-button" onClick={() => setRealLifeOpen(true)}><CircleHelp size={15} /> How it works in real life</button>
        <button className={`primary-button ${simulatorMode ? "simulator-button-active" : ""}`} onClick={toggleSimulator}><FlaskConical size={15} /> {simulatorMode ? "Simulator controls" : "Simulator"}</button>
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
    </main>
  );
}

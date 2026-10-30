"use client";

import { Activity, Radio, Signal, SignalZero } from "lucide-react";
import type { NodeRow, ReadingRow, Severity } from "@/lib/types";

export function TopBar({
  node,
  latest,
  online,
  warming,
  testMode,
  simulator,
  severity,
  polling,
  time,
}: {
  node: NodeRow | null;
  latest: ReadingRow | null;
  online: boolean;
  warming: boolean;
  testMode: boolean;
  simulator: boolean;
  severity: Severity;
  polling: boolean;
  time: string;
}) {
  const statusText = simulator
    ? "SIMULATOR"
    : warming
      ? "WARMING UP"
      : online
        ? "LIVE"
        : "OFFLINE";
  const lastSeenAt = latest?.received_at ?? node?.last_seen;
  const lastSeen = lastSeenAt
    ? new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Johannesburg" }).format(new Date(lastSeenAt))
    : "no readings yet";

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark"><Activity size={20} /></span>
        <div>
          <strong>SASOL<span>SNIFF</span></strong>
          <small>{node?.name ?? "AIR QUALITY NETWORK"}</small>
        </div>
      </div>
      <div className="topbar-meta">
        <span className={`status-pill ${online || simulator ? "status-live" : "status-offline"}`}>
          {online || simulator ? <Signal size={14} /> : <SignalZero size={14} />}
          {statusText}
        </span>
        {warming && <span className="warmup-progress" title="Sensor is warming up"><span /></span>}
        {!online && !simulator && <small className="last-seen">LAST SEEN {lastSeen}</small>}
        {polling && !simulator && <span className="polling-indicator"><span /> POLLING</span>}
        <span className={`mode-pill ${simulator ? "mode-sim" : ""}`}>
          {simulator ? "SIMULATOR MODE" : <><Radio size={13} /> LIVE MODE</>}
        </span>
        {testMode && <span className="test-pill">TEST SURGE</span>}
        {severity !== "none" && <span className={`severity-pill severity-${severity}`}>{severity}</span>}
        <time className="topbar-clock">{time}</time>
      </div>
    </header>
  );
}

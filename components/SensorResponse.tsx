"use client";

import { Activity, Gauge } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { Panel } from "./Panel";
import type { ReadingRow } from "@/lib/types";

export function SensorResponse({
  readings,
  latest,
  simulated,
}: {
  readings: ReadingRow[];
  latest: ReadingRow | null;
  simulated: boolean;
}) {
  const fusion = latest?.fusion;
  const rise = fusion?.rise ?? (latest ? latest.gas_raw - (latest.baseline_raw ?? latest.gas_raw) : 0);
  const threshold = fusion?.threshold ?? 150;
  const percent = Math.max(0, Math.min(100, (rise / Math.max(threshold * 2.5, 1)) * 100));
  const data = readings.slice(-30).map((reading) => ({
    ts: new Date(reading.ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    gas: reading.gas_raw,
    baseline: reading.baseline_raw ?? 0,
  }));
  return (
    <Panel title="Sensor response" eyebrow="LIVE SENSOR" simulated={simulated}>
      <div className="sensor-reading-row">
        <div>
          <div className="metric-large">{rise.toLocaleString()}<span> raw</span></div>
          <p className="muted-copy">Sensor response above clean-air baseline</p>
        </div>
        <div className="sensor-icon"><Gauge size={22} /></div>
      </div>
      <div className="sensor-meter"><span style={{ width: `${percent}%` }} className={fusion?.surge ? "meter-hot" : ""} /></div>
      <div className="meter-scale">
        <span>Threshold <b>{threshold.toLocaleString()}</b></span>
        <span>{fusion?.surge ? "SURGE DETECTED" : "NORMAL RANGE"}</span>
      </div>
      <div className="sensor-values">
        <div><small>GAS RAW</small><strong>{latest?.gas_raw.toLocaleString() ?? "—"}</strong></div>
        <div><small>BASELINE</small><strong>{latest?.baseline_raw?.toLocaleString() ?? "—"}</strong></div>
        <div><small>RISE RATE</small><strong>{fusion?.slope_per_s.toFixed(1) ?? "0.0"}<i>/s</i></strong></div>
      </div>
      <div className="sparkline-wrap">
        {data.length > 1 ? (
          <ResponsiveContainer width="100%" height={50}>
            <AreaChart data={data}>
              <defs><linearGradient id="spark" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0} /></linearGradient></defs>
              <Tooltip contentStyle={{ background: "#0b1725", border: "1px solid #223348", borderRadius: 8 }} />
              <Area type="monotone" dataKey="gas" stroke="#22d3ee" strokeWidth={2} fill="url(#spark)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div className="empty-spark"><Activity size={14} /> Waiting for readings</div>}
      </div>
    </Panel>
  );
}

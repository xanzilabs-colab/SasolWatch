"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel } from "./Panel";
import type { AlertRow, EventRow, ReadingRow } from "@/lib/types";

export function Timeline({
  readings,
  events,
  alerts,
  simulated,
}: {
  readings: ReadingRow[];
  events: EventRow[];
  alerts: AlertRow[];
  simulated: boolean;
}) {
  const data = readings.slice(-150).map((reading) => ({
    time: reading.ts,
    gas: reading.gas_raw,
    baseline: reading.baseline_raw ?? 0,
    threshold: (reading.baseline_raw ?? 0) + (reading.fusion?.threshold ?? 150),
    thresholdDelta: reading.fusion?.threshold ?? 150,
    fusion: reading.fusion,
  }));
  const alertTimes = alerts.map((alert) => alert.created_at);
  return (
    <Panel title="Sensor history" eyebrow="GAS RESPONSE · LAST 300 READINGS" className="timeline-panel" simulated={simulated}>
      {data.length < 2 ? <div className="timeline-empty">The trend will appear when readings arrive.</div> : (
        <div className="timeline-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <defs><linearGradient id="gas-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0b4f9c" stopOpacity={0.2} /><stop offset="100%" stopColor="#0b4f9c" stopOpacity={0.01} /></linearGradient></defs>
              <CartesianGrid stroke="#e6e9ee" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="time" tickFormatter={(value: string) => new Date(value).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "#718397", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={45} />
              <YAxis tick={{ fill: "#718397", fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                labelFormatter={(value) => new Date(String(value)).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "medium" })}
                contentStyle={{ background: "#fff", border: "1px solid #d5dae2", borderRadius: 6, color: "#172436", boxShadow: "0 2px 8px #10182820" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0]?.payload as (typeof data)[number] | undefined;
                  return <div className="chart-tooltip"><small>{label ? new Date(String(label)).toLocaleString() : ""}</small><b>Gas raw · {point?.gas?.toLocaleString()}</b><span>Baseline · {point?.baseline?.toLocaleString()}</span><span>Threshold · {point?.threshold?.toLocaleString()}</span>{point?.fusion?.surge && <em>{point.fusion.source_label} · {Math.round(point.fusion.confidence * 100)}% estimate</em>}</div>;
                }}
              />
              {events.map((event) => {
                const start = event.started_at;
                const end = event.ended_at ?? data[data.length - 1]?.time;
                return start && end ? <ReferenceArea key={event.id} x1={start} x2={end} fill="#f97316" fillOpacity={0.09} strokeOpacity={0} /> : null;
              })}
              {alertTimes.map((time, index) => <ReferenceLine key={`${time}-${index}`} x={time} stroke="#f59e0b" strokeDasharray="2 4" strokeOpacity={0.6} />)}
              <Area type="stepAfter" dataKey="baseline" stackId="threshold-band" stroke="none" fill="transparent" isAnimationActive={false} />
              <Area type="stepAfter" dataKey="thresholdDelta" stackId="threshold-band" stroke="none" fill="#f59e0b" fillOpacity={0.08} isAnimationActive={false} />
              <Area type="monotone" dataKey="gas" name="gas" stroke="#0b4f9c" strokeWidth={2} fill="url(#gas-fill)" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="baseline" name="baseline" stroke="#718397" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="threshold" name="threshold" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="timeline-legend"><span><i className="gas-legend" /> Gas raw</span><span><i className="baseline-legend" /> Clean-air baseline</span><span><i className="threshold-legend" /> Surge threshold</span><span><i className="event-legend" /> Event / alert</span></div>
    </Panel>
  );
}

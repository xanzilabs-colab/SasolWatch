"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReadingRow } from "@/lib/types";

export function ReportChart({ readings }: { readings: ReadingRow[] }) {
  const data = readings.map((reading) => ({
    time: new Date(reading.ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    gas: reading.gas_raw,
    baseline: reading.baseline_raw ?? 0,
    threshold: (reading.baseline_raw ?? 0) + (reading.fusion?.threshold ?? 150),
  }));
  if (!data.length) return <p>No sensor readings were retained for this event window.</p>;
  return <div className="report-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data}><CartesianGrid stroke="#d7dee5" /><XAxis dataKey="time" /><YAxis /><Tooltip /><Area dataKey="gas" stroke="#087e8b" fill="#bdeef1" /><Line dataKey="baseline" stroke="#64748b" /><Line dataKey="threshold" stroke="#d97706" strokeDasharray="5 4" /></ComposedChart></ResponsiveContainer></div>;
}

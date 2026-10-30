import { CheckCircle2, CircleHelp } from "lucide-react";
import { Panel } from "./Panel";
import type { Fusion, ReadingRow } from "@/lib/types";

const labels: Record<string, string> = {
  industrial_plume: "Industrial plume",
  household_burning: "Household burning",
  traffic: "Traffic",
  open_burning: "Open burning / waste",
};

export function ClassifierPanel({ fusion, active, simulated, reading }: { fusion: Fusion | null; active: boolean; simulated: boolean; reading: ReadingRow | null }) {
  const scoreEntries = fusion ? Object.entries(fusion.scores).sort((a, b) => b[1] - a[1]) : [];
  const sharpness = fusion?.sharpness ?? 0;
  const candidates = fusion?.candidates ?? [];
  const upwind = candidates[0];
  const numericHour = reading?.ts
    ? Number(new Date(reading.ts).toLocaleString("en-ZA", { hour: "numeric", hour12: false, timeZone: "Africa/Johannesburg" }))
    : 12;
  const reasons = fusion && active ? [
    `${sharpness >= 0.55 ? "Sudden" : "Gradual"} onset (sharpness ${sharpness.toFixed(1)})`,
    upwind
      ?       `Wind from ${fusion.wind.compass_from}; ${upwind.kind.replaceAll("_", " ")} lies in the ${upwind.illustrative ? "illustrative" : "registered"} upwind sector`
      : `Wind from ${fusion.wind.compass_from}; no verified source coordinate is inside the current cone`,
    numericHour >= 17 || numericHour < 8
      ? "Time of day may favour evening or morning sources"
      : "Daytime conditions are included in the rule estimate",
    reading?.temperature_c == null
      ? "No node temperature reading was available for this estimate"
      : `Node temperature ${reading.temperature_c.toFixed(1)} °C is included as context`,
    reading?.humidity_pct == null
      ? "No node humidity reading was available for this estimate"
      : `Node humidity ${reading.humidity_pct.toFixed(1)}% is included as context`,
    fusion.weather?.precipitation_mm == null
      ? "Local rain data is unavailable"
      : fusion.weather.raining ? "Local weather reports rain" : "Local weather reports no significant rain",
  ] : [];
  return (
    <Panel title="Source classifier" eyebrow="RULE-BASED ESTIMATE" simulated={simulated}>
      {!active ? (
        <div className="no-surge-note"><CircleHelp size={18} /><div><strong>No surge</strong><p>Air within normal range. Monitoring.</p></div></div>
      ) : !fusion ? (
        <div className="no-surge-note"><CircleHelp size={18} /><div><strong>Analysis unavailable</strong><p>A sensor rise is present, but a fresh verified analysis is not available yet.</p></div></div>
      ) : (
        <>
          <div className="classifier-result">
            <div><small>ESTIMATED SOURCE</small><strong>{fusion.source_label}</strong></div>
            <span>{Math.round(fusion.confidence * 100)}%</span>
          </div>
          <p className="panel-caption">Estimated source, not proof.</p>
          <div className="score-list">
            {scoreEntries.map(([key, score]) => (
              <div className="score-row" key={key}>
                <div><span>{labels[key] ?? key}</span><b>{Math.round(score * 100)}%</b></div>
                <div className="score-track"><span className={key === fusion.source_type ? "score-winner" : ""} style={{ width: `${score * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="why-block">
            <h3>Why we think this</h3>
            {reasons.map((reason) => <p key={reason}><CheckCircle2 size={13} />{reason}</p>)}
          </div>
        </>
      )}
    </Panel>
  );
}

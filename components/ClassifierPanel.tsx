import { CheckCircle2, CircleHelp } from "lucide-react";
import { Panel } from "./Panel";
import type { Fusion } from "@/lib/types";

const labels: Record<string, string> = {
  industrial_plume: "Industrial plume",
  household_burning: "Household burning",
  traffic: "Traffic",
  open_burning: "Open burning / waste",
};

export function ClassifierPanel({ fusion, active, simulated, readingTime }: { fusion: Fusion | null; active: boolean; simulated: boolean; readingTime?: string }) {
  const scoreEntries = fusion ? Object.entries(fusion.scores).sort((a, b) => b[1] - a[1]) : [];
  const sharpness = fusion?.sharpness ?? 0;
  const candidates = fusion?.candidates ?? [];
  const upwind = candidates[0];
  const numericHour = readingTime
    ? Number(new Date(readingTime).toLocaleString("en-ZA", { hour: "numeric", hour12: false, timeZone: "Africa/Johannesburg" }))
    : 12;
  const reasons = fusion && active ? [
    `${sharpness >= 0.55 ? "Sudden" : "Gradual"} onset (sharpness ${sharpness.toFixed(1)})`,
    upwind
      ? `Wind from ${fusion.wind.compass_from}; ${upwind.kind.replaceAll("_", " ")} lies in the illustrative upwind cone`
      : `Wind from ${fusion.wind.compass_from}; no candidate source is inside the current cone`,
    numericHour >= 17 || numericHour < 8
      ? "Time of day may favour evening or morning sources"
      : "Daytime conditions are included in the rule estimate",
    (fusion.weather?.temperature_c ?? 20) < 15
      ? "Cool local temperature may favour household burning"
      : `Humidity adjustment factor ${fusion.humidity_factor.toFixed(2)}`,
    fusion.weather?.raining ? "Rain is present and reduces particle estimates" : "No significant rain recorded",
  ] : [];
  return (
    <Panel title="Source classifier" eyebrow="RULE-BASED ESTIMATE" simulated={simulated}>
      {!active || !fusion ? (
        <div className="no-surge-note"><CircleHelp size={18} /><div><strong>No surge</strong><p>Air within normal range. Monitoring.</p></div></div>
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

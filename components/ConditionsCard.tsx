import { Droplets, RadioTower, Thermometer } from "lucide-react";
import { Panel } from "./Panel";
import type { ReadingRow } from "@/lib/types";

export function ConditionsCard({ latest, simulated }: { latest: ReadingRow | null; simulated: boolean }) {
  return (
    <Panel title="Node conditions" eyebrow="ENVIRONMENT" simulated={simulated}>
      <div className="conditions-grid">
        <div className="condition-cell"><Thermometer size={17} /><small>TEMPERATURE</small><strong>{latest?.temperature_c == null ? "—" : `${latest.temperature_c.toFixed(1)}°`}<i>C</i></strong></div>
        <div className="condition-cell"><Droplets size={17} /><small>HUMIDITY</small><strong>{latest?.humidity_pct == null ? "—" : `${Math.round(latest.humidity_pct)}%`}</strong></div>
        <div className="condition-cell"><RadioTower size={17} /><small>RSSI</small><strong>{latest?.rssi == null ? "—" : `${latest.rssi}`}<i> dBm</i></strong></div>
      </div>
      <p className="condition-footnote">On-node readings from the temperature / humidity sensor.</p>
    </Panel>
  );
}

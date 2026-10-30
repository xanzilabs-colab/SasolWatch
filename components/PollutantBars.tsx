import { Panel } from "./Panel";
import type { Fusion } from "@/lib/types";
import { PEAK } from "@/lib/fusion";

const pollutantLabels: Record<string, string> = {
  pm25: "PM2.5", pm10: "PM10", no2: "NO₂", so2: "SO₂", h2s: "H₂S", co: "CO", voc: "VOC",
};

export function PollutantBars({ fusion, simulated }: { fusion: Fusion | null; simulated: boolean }) {
  const pollutants = fusion?.pollutants;
  return (
    <Panel title="Pollutant estimates" eyebrow="AIR PROFILE" simulated={simulated || Boolean(pollutants)}>
      <p className="panel-caption">Simulated from sensor rise. Real deployment measures each pollutant.</p>
      <div className="pollutant-list">
        {Object.entries(pollutantLabels).map(([key, label]) => {
          const item = pollutants?.[key as keyof NonNullable<typeof pollutants>];
          const amount = item?.value ?? 0;
          const fill = Math.min(100, (amount / (PEAK[key] || 1)) * 100);
          const tone = fill > 70 ? "pollutant-hot" : fill > 38 ? "pollutant-warm" : "pollutant-cool";
          return (
            <div className="pollutant-row" key={key}>
              <div className="pollutant-line"><span>{label}</span><b>{amount.toLocaleString(undefined, { maximumFractionDigits: 1 })}<small> {item?.unit ?? ""}</small></b></div>
              <div className="pollutant-track"><span className={tone} style={{ width: `${fill}%` }} /></div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

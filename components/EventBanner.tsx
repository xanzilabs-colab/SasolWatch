import { AlertTriangle, Wind } from "lucide-react";
import type { EventRow, Fusion } from "@/lib/types";

export function EventBanner({ fusion, event, now }: { fusion: Fusion | null; event: EventRow | null; now: number }) {
  if (!fusion || (!fusion.surge && !event)) return null;
  const severity = event?.severity ?? fusion.severity;
  const started = event?.started_at ? Date.parse(event.started_at) : now;
  const duration = Math.max(0, Math.floor((now - started) / 1000));
  const durationLabel = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`;

  return (
    <section className={`event-banner severity-${severity}`}>
      <div className="event-banner-icon"><AlertTriangle size={24} /></div>
      <div className="event-main">
        <div className="event-title-row">
          <span className="event-severity">{severity} SENSOR EVENT</span>
          {event?.test_mode && <span className="test-pill">TEST</span>}
          <span className="event-duration">ACTIVE {durationLabel}</span>
        </div>
        <h1>Source hypothesis: {fusion.source_label}<span> · {Math.round(fusion.confidence * 100)}% rule score</span></h1>
        <p>{fusion.guidance}</p>
        <small>Surge score {fusion.surge_score ?? "—"}/100. Early-warning estimate, not a measured pollutant or confirmed cause.</small>
      </div>
      <div className="event-wind">
        <Wind size={19} />
        <span>WIND FROM</span>
        <strong>{fusion.wind.compass_from}</strong>
        <small>{fusion.wind.from_deg}°</small>
      </div>
    </section>
  );
}

import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { Panel } from "./Panel";
import type { EventRow } from "@/lib/types";

export function EventsList({ events, simulated, now }: { events: EventRow[]; simulated: boolean; now: number }) {
  return (
    <Panel title="Recent events" eyebrow="INVESTIGATION LOG" simulated={simulated}>
      {events.length === 0 ? <div className="empty-state">No events recorded. The dashboard is monitoring for surges.</div> : (
        <div className="event-list">
          {events.map((event) => {
            const end = event.ended_at ? Date.parse(event.ended_at) : now;
            const duration = Math.max(0, Math.round((end - Date.parse(event.started_at)) / 60000));
            return (
              <article className="event-list-row" key={event.id}>
                <span className={`event-severity-dot severity-${event.severity}`} />
                <div className="event-list-copy">
                  <strong>{event.source_type ? `Hypothesis: ${event.source_type.replaceAll("_", " ")}` : "Sensor response event"}</strong>
                  <small><Clock3 size={12} /> {new Date(event.started_at).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Johannesburg" })} · {duration} min {event.test_mode && <b>· TEST</b>}</small>
                </div>
                <span className={`severity-text severity-${event.severity}`}>{event.severity}</span>
                <Link href={`/report/${event.id}`} className="report-link" aria-label={`Open report for event ${event.id}`}><span>Report</span><ArrowUpRight size={14} /></Link>
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { ArrowLeft } from "lucide-react";
import { ReportChart } from "@/components/ReportChart";
import { PrintButton } from "@/components/PrintButton";
import type { AlertRow, EventRow, Fusion, NodeRow, ReadingRow } from "@/lib/types";
import { compassDirection } from "@/lib/geo";

export const dynamic = "force-dynamic";

type ReportProps = { params: Promise<{ eventId: string }> | { eventId: string } };

export default async function EventReport({ params }: ReportProps) {
  const { eventId } = await params;
  const id = Number(eventId);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!Number.isSafeInteger(id) || id < 1) return <ReportMessage title="Invalid report" detail="The event identifier is not valid." />;
  if (!url || !key) return <ReportMessage title="Supabase is not configured" detail="Add the project URL and anon key to .env.local to view event reports." />;

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: rawEvent, error } = await client.from("events").select("*").eq("id", id).maybeSingle();
  if (error) return <ReportMessage title="Could not load report" detail={error.message} />;
  if (!rawEvent) return <ReportMessage title="Event not found" detail={`No event ${eventId} is available to this dashboard.`} />;
  const event = rawEvent as EventRow;
  const from = new Date(Date.parse(event.started_at) - 120_000).toISOString();
  const through = new Date(Date.parse(event.ended_at ?? new Date().toISOString()) + 120_000).toISOString();
  const [nodeResult, readingResult, alertResult] = await Promise.all([
    client.from("nodes").select("*").eq("id", event.node_id).maybeSingle(),
    client.from("readings").select("*").eq("node_id", event.node_id).gte("ts", from).lte("ts", through).order("ts", { ascending: true }),
    client.from("alerts").select("*").eq("event_id", id).order("created_at", { ascending: true }),
  ]);
  const readError = nodeResult.error ?? readingResult.error ?? alertResult.error;
  if (readError) return <ReportMessage title="Could not load report data" detail={readError.message} />;
  const node = nodeResult.data as NodeRow | null;
  const readings = (readingResult.data as ReadingRow[] | null) ?? [];
  const alerts = (alertResult.data as AlertRow[] | null) ?? [];
  const summary = event.summary as Fusion | null;
  const durationMinutes = Math.max(0, Math.round((Date.parse(event.ended_at ?? new Date().toISOString()) - Date.parse(event.started_at)) / 60000));

  return (
    <main className="report-page">
      <nav className="report-actions no-print"><Link href="/"><ArrowLeft size={15} /> Dashboard</Link><PrintButton /></nav>
      <article className="report-paper">
        <header className="report-heading">
          <div><p className="report-kicker">SASOLSNIFF · AIR QUALITY MONITORING</p><h1>Investigation Report</h1><p>Event {event.id} · {node?.name ?? event.node_id}</p></div>
          <div className="report-severity"><span className={`severity-text severity-${event.severity}`}>{event.severity.toUpperCase()}</span>{event.test_mode && <b>TEST EVENT</b>}</div>
        </header>
        <section className="report-facts">
          <div><small>STARTED</small><strong>{new Date(event.started_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}</strong></div>
          <div><small>ENDED</small><strong>{event.ended_at ? new Date(event.ended_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "Event remains open"}</strong></div>
          <div><small>DURATION</small><strong>{durationMinutes} minutes</strong></div>
          <div><small>PEAK GAS RAW</small><strong>{event.peak_gas_raw?.toLocaleString() ?? "—"}</strong></div>
        </section>
        <section className="report-section">
          <h2>Summary and estimate</h2>
          <div className="report-summary-grid">
            <p><small>Estimated source</small><strong>{summary?.source_label ?? event.source_type?.replaceAll("_", " ") ?? "Unavailable"}</strong></p>
            <p><small>Confidence</small><strong>{Math.round((summary?.confidence ?? event.confidence ?? 0) * 100)}%</strong></p>
            <p><small>Wind from device potentiometer</small><strong>{event.wind_from_deg == null ? "—" : `${compassDirection(event.wind_from_deg)} (${event.wind_from_deg.toFixed(1)}°)`}</strong></p>
          </div>
          <p>{summary?.guidance ?? "No guidance summary was stored for this event."}</p>
          <p className="report-caveat">This is an early-warning estimate, not a confirmed cause.</p>
        </section>
        <section className="report-section">
          <h2>Sensor response</h2>
          <ReportChart readings={readings} />
          <p className="report-note">Gas raw values are proxy sensor readings. The threshold is based on the stored reading fusion summary.</p>
        </section>
        <div className="report-two-col">
          <section className="report-section">
            <h2>Wind and weather at peak</h2>
            <dl className="report-definition-list">
              <dt>Wind direction</dt><dd>{event.wind_from_deg == null ? "—" : `${compassDirection(event.wind_from_deg)} ${event.wind_from_deg.toFixed(1)}° from / ${compassDirection(event.wind_from_deg + 180)} toward (device potentiometer)`}</dd>
              <dt>Wind speed</dt><dd>{summary?.wind.speed_ms?.toFixed(1) ?? "—"} m/s{summary?.wind.speed_assumed ? " (assumed)" : ""}</dd>
              <dt>Temperature</dt><dd>{summary?.weather?.temperature_c ?? "—"} °C</dd>
              <dt>Humidity</dt><dd>{summary?.weather?.humidity_pct ?? "—"}%</dd>
              <dt>Precipitation</dt><dd>{summary?.weather?.precipitation_mm ?? "—"} mm</dd>
            </dl>
          </section>
          <section className="report-section">
            <h2>Measured inputs</h2>
            <p>This node records a raw MQ sensor response, wind-potentiometer position, and DHT11 temperature and humidity. It has no direct PM2.5, PM10, NO₂, SO₂, H₂S, CO or VOC sensors, so those concentrations and AQI are not reported.</p>
          </section>
        </div>
        <section className="report-section">
          <h2>Candidate source areas</h2>
          <table className="report-table"><thead><tr><th>Candidate</th><th>Bearing</th><th>Distance</th><th>ETA</th><th>Data note</th></tr></thead><tbody>
            {summary?.candidates.length ? summary.candidates.map((candidate) => <tr key={candidate.id}><td>{candidate.name}</td><td>{candidate.bearing_deg}°</td><td>{candidate.distance_km} km</td><td>{candidate.eta_min == null ? "Unavailable" : `${candidate.eta_min} min`}</td><td>{candidate.illustrative ? "Illustrative" : "Unverified"}</td></tr>) : <tr><td colSpan={5}>No candidate sources were in the upwind cone.</td></tr>}
          </tbody></table>
        </section>
        <section className="report-section">
          <h2>Alert log</h2>
          {alerts.length ? <table className="report-table"><thead><tr><th>Time</th><th>Recipient</th><th>Status</th><th>Severity</th></tr></thead><tbody>{alerts.map((alert) => <tr key={alert.id}><td>{new Date(alert.created_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}</td><td>{alert.recipient_name ?? "—"}</td><td>{alert.status}</td><td>{alert.severity ?? "—"}</td></tr>)}</tbody></table> : <p>No alert rows are associated with this event.</p>}
        </section>
        <footer className="report-method">
          <strong>Method and limitations</strong>
          <p>This prototype uses a low-cost gas/smoke proxy sensor. Its raw response does not identify a specific chemical or measure pollutant concentrations. The source classification is a rule-based estimate and source positions may be illustrative; neither proves a source. The system complements, but does not replace, calibrated equipment and official monitoring stations.</p>
        </footer>
      </article>
    </main>
  );
}

function ReportMessage({ title, detail }: { title: string; detail: string }) {
  return <main className="report-message"><Link href="/">← Dashboard</Link><h1>{title}</h1><p>{detail}</p></main>;
}

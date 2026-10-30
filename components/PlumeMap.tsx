"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
} from "react-leaflet";
import { ArrowUpRight, MapPin } from "lucide-react";
import { buildCone, compassDirection, destinationPoint } from "@/lib/geo";
import type { Fusion, NodeRow, SourceRow } from "@/lib/types";
import { Panel } from "./Panel";

const severityColor: Record<string, string> = {
  none: "#22d3ee", low: "#f59e0b", moderate: "#f59e0b", high: "#f97316", severe: "#ef4444",
};
const kindIcon: Record<string, string> = {
  industrial: "⌂", power: "ϟ", mine: "◆", waste_treatment: "≋", residential: "⌂", road: "⇢",
};
const profileLabels: Record<string, { name: string; pollutants: string }> = {
  industrial_plume: { name: "Industrial/process", pollutants: "SO₂ · NO₂ · VOC · H₂S" },
  household_burning: { name: "Household combustion", pollutants: "PM · CO · VOC" },
  traffic: { name: "Traffic combustion", pollutants: "NO₂ · CO · VOC · PM" },
  open_burning: { name: "Open burning", pollutants: "PM · CO · VOC" },
};

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export default function PlumeMap({
  node,
  sources,
  fusion,
  simulator,
  windFromDeg,
  windRaw,
  readingTime,
}: {
  node: NodeRow | null;
  sources: SourceRow[];
  fusion: Fusion | null;
  simulator: boolean;
  windFromDeg: number | null;
  windRaw: number | null;
  readingTime?: string | null;
}) {
  const [mapReady, setMapReady] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [particleTick, setParticleTick] = useState(0);
  const surge = Boolean(fusion?.surge);
  const color = severityColor[fusion?.severity ?? "none"];
  const from = windFromDeg;
  const to = from == null ? null : (from + 180) % 360;
  const sectorHalfWidth = Math.max(10, Math.min(35, fusion?.wind.sector_halfwidth_deg ?? 15));
  const flowSector = node && to != null
    ? buildCone(node.lat, node.lon, to, sectorHalfWidth, 7)
    : [];
  const hypotheses = surge && fusion
    ? Object.entries(fusion.scores)
      .sort((a, b) => b[1] - a[1])
      .map(([type, score]) => ({ ...profileLabels[type], score }))
      .filter((hypothesis) => hypothesis.name)
    : [];
  const analysisTag = hypotheses.length
    ? L.divIcon({
      className: "",
      html: `<div class="plume-analysis-tag"><strong>MODELLED SOURCE HYPOTHESES</strong><ul>${hypotheses.map((item) =>
        `<li><b>${escapeHtml(item.name)}</b><span>${Math.round(item.score * 100)}% rule score</span><small>Possible profile: ${escapeHtml(item.pollutants)}</small></li>`
      ).join("")}</ul><small>Not pollutant measurements. MQ sensor reports raw response only.</small></div>`,
      iconSize: [245, 170],
      iconAnchor: [0, 0],
    })
    : null;
  const readingTimeLabel = readingTime && Number.isFinite(Date.parse(readingTime))
    ? new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(readingTime))
    : null;

  useEffect(() => {
    const timer = window.setTimeout(() => setMapReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionEnabled(!media.matches);
    const timer = window.setTimeout(update, 0);
    media.addEventListener("change", update);
    return () => {
      window.clearTimeout(timer);
      media.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!motionEnabled || !surge || !simulator) return;
    const timer = window.setInterval(() => setParticleTick((tick) => tick + 1), 900);
    return () => window.clearInterval(timer);
  }, [motionEnabled, simulator, surge]);

  const particleCount = simulator && surge ? Math.min(20, 4 + Math.round((fusion?.intensity ?? 0) * 28)) : 0;
  const particles = node ? Array.from({ length: particleCount }, (_, index) => {
    const progress = ((index / Math.max(1, particleCount)) + (particleTick * 0.035 * Math.max(0.5, fusion?.wind.speed_ms ?? 1))) % 1;
    const alongKm = -7 + progress * 14;
    const point = alongKm < 0
      ? destinationPoint(node.lat, node.lon, from ?? fusion?.wind.from_deg ?? 0, Math.abs(alongKm))
      : destinationPoint(node.lat, node.lon, to ?? fusion?.wind.to_deg ?? 180, alongKm);
    return { point, key: `${index}-${particleTick}` };
  }) : [];

  const nodeIcon = useMemo(() => L.divIcon({
    className: "",
    html: `<div class="map-node" style="--node-color:${color}"><span></span><label>${escapeHtml(node?.name ?? "SasolSniff node")}</label></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  }), [color, node?.name]);

  return (
    <Panel title="Live plume map" eyebrow={node ? `NODE · ${node.lat.toFixed(4)}°, ${node.lon.toFixed(4)}°` : "WAITING FOR REGISTERED NODE"} className="map-panel" simulated={simulator}>
      <div className="map-frame">
        {node && mapReady ? <MapContainer center={[node.lat, node.lon]} zoom={13} zoomControl={false} scrollWheelZoom className="leaflet-map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={[node.lat, node.lon]} icon={nodeIcon}>
            <Tooltip direction="top" offset={[0, -6]}>{node.name}</Tooltip>
          </Marker>
          {flowSector.length > 0 && (
            <Polygon
              positions={flowSector}
              pathOptions={{ color, weight: surge ? 2 : 1, dashArray: "7 7", fillColor: color, fillOpacity: surge ? 0.18 : 0.08 }}
            />
          )}
          {to != null && (
            <Polyline
              positions={[[node.lat, node.lon], destinationPoint(node.lat, node.lon, to, 7)]}
              pathOptions={{ color: "#22d3ee", weight: 2, dashArray: "5 8", opacity: surge ? 0.9 : 0.65 }}
            />
          )}
          {sources.map((source) => {
            const candidate = surge ? fusion?.candidates.find((item) => String(item.id) === String(source.id)) : undefined;
            const score = Math.max(0, Math.min(1, candidate?.score ?? 0));
            const sourceIcon = L.divIcon({
              className: "",
              html: `<span class="source-map-icon ${candidate ? "source-map-candidate" : ""}" style="--candidate-ring:${2 + score * 5}px">${escapeHtml(kindIcon[source.kind] ?? "•")}</span>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14],
            });
            return (
              <Fragment key={source.id}>
                {surge && candidate && <Polyline positions={[[node.lat, node.lon], [source.lat, source.lon]]} pathOptions={{ color, weight: 1, dashArray: "3 6", opacity: 0.45 }} />}
                <Marker position={[source.lat, source.lon]} icon={sourceIcon}>
                  <Tooltip direction="top">
                    <b>{source.name}</b><br />
                    {candidate ? `${candidate.bearing_deg}° · ${candidate.distance_km} km · ETA ${candidate.eta_min == null ? "unavailable" : `${candidate.eta_min} min`}` : source.kind}
                    {source.illustrative ? " · Illustrative" : ""}
                  </Tooltip>
                </Marker>
              </Fragment>
            );
          })}
          {motionEnabled && particles.map(({ point, key }) => (
            <CircleMarker key={key} center={point} radius={2.5} pathOptions={{ color, fillColor: color, fillOpacity: 0.85, weight: 0 }} />
          ))}
          {surge && from != null && (
            <Marker position={destinationPoint(node.lat, node.lon, from, 7.7)} icon={L.divIcon({ className: "map-tip", html: `<span>UPWIND · ${escapeHtml(compassDirection(from))} ${from.toFixed(1)}°</span>`, iconAnchor: [0, 0] })} />
          )}
          {surge && to != null && analysisTag && (
            <Marker position={destinationPoint(node.lat, node.lon, to, 3.3)} icon={analysisTag} interactive={false} />
          )}
          {from != null && to != null && (
            <Marker
              position={destinationPoint(node.lat, node.lon, to, surge ? 7.7 : 3)}
              icon={L.divIcon({
                className: "",
                html: `<span class="device-wind-arrow" style="transform:rotate(${to}deg)" aria-label="Wind flows toward ${escapeHtml(compassDirection(to))}">↑</span>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
              })}
            />
          )}
          <ZoomControl position="bottomright" />
        </MapContainer> : <div className="leaflet-map" />}
        <div className="map-compass" aria-hidden="true"><ArrowUpRight size={20} /><span>N</span></div>
        <div className="map-footer">
          <span><MapPin size={13} /> {from == null ? "Waiting for device wind-potentiometer reading" : `${simulator ? "SIMULATOR" : "DEVICE VANE"} · FROM ${compassDirection(from)} ${from.toFixed(1)}° · ADC ${windRaw ?? "—"} / 4095${readingTimeLabel ? ` · SAMPLE ${readingTimeLabel} SAST` : ""}`}</span>
          <span>{surge && fusion?.wind ? `UPWIND SECTOR ±${fusion.wind.sector_halfwidth_deg}° · ` : ""}{to == null ? "Wind-flow direction unavailable" : `FLOW → ${compassDirection(to)} ${to.toFixed(1)}° · DEVICE-VANE DIRECTION CORRIDOR (NOT A DISPERSION MODEL)`}{surge && fusion?.wind ? ` · ${fusion.wind.speed_ms == null ? "weather speed unavailable" : `${fusion.wind.speed_ms.toFixed(1)} m/s weather speed`}` : ""}</span>
        </div>
        {!node && <div className="map-data-notice">No registered node coordinates are available. Add the sensor&apos;s real location in Supabase; placeholder coordinates are not shown.</div>}
        {node && sources.length === 0 && (
          <div className="map-data-notice">
            No verified source coordinates are registered. The map shows the device&apos;s measured wind direction only; illustrative seed locations are hidden from live analysis.
          </div>
        )}
        {simulator && <div className="sim-watermark" aria-hidden="true">SIMULATED — NOT FROM DEVICE</div>}
      </div>
      <div className="map-legend">
        <span><i className="legend-node" /> Node</span>
        <span><i className="legend-wind" /> Vane flow</span>
        <span><i className="legend-cone" /> Device-vane direction corridor</span>
        {sources.length > 0 && <span><i className="legend-source" /> {simulator ? "Scenario source" : "Verified source"}</span>}
        <small>{simulator ? "Scenario locations are illustrative." : "Only verified source coordinates are shown."}</small>
      </div>
    </Panel>
  );
}

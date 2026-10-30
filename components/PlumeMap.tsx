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
  useMap,
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

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function FitMap({ node, fusion, active, windFromDeg }: { node: NodeRow; fusion: Fusion | null; active: boolean; windFromDeg: number | null }) {
  const map = useMap();
  const from = windFromDeg;
  const halfWidth = fusion?.wind.sector_halfwidth_deg;
  useEffect(() => {
    const lat = node.lat;
    const lon = node.lon;
    if (active && from != null && halfWidth != null) {
      const bounds = L.latLngBounds([
        [lat, lon],
        ...buildCone(lat, lon, from, halfWidth, 8),
      ]);
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13, animate: true });
    } else {
      map.setView([lat, lon], 13, { animate: true });
    }
  }, [active, from, halfWidth, map, node.lat, node.lon]);
  return null;
}

export default function PlumeMap({
  node,
  sources,
  fusion,
  simulator,
  windFromDeg,
  windRaw,
}: {
  node: NodeRow | null;
  sources: SourceRow[];
  fusion: Fusion | null;
  simulator: boolean;
  windFromDeg: number | null;
  windRaw: number | null;
}) {
  const [mapReady, setMapReady] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [particleTick, setParticleTick] = useState(0);
  const surge = Boolean(fusion?.surge);
  const color = severityColor[fusion?.severity ?? "none"];
  const from = windFromDeg;
  const to = from == null ? null : (from + 180) % 360;

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

  const cone = node && fusion?.wind && from != null
    ? buildCone(node.lat, node.lon, from, fusion.wind.sector_halfwidth_deg, 8)
    : [];
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
          <FitMap node={node} fusion={fusion} active={surge} windFromDeg={from} />
          <Marker position={[node.lat, node.lon]} icon={nodeIcon}>
            <Tooltip direction="top" offset={[0, -6]}>{node.name}</Tooltip>
          </Marker>
          {surge && cone.length > 0 && (
            <>
              <Polygon positions={cone} pathOptions={{ color, weight: 2, dashArray: "7 7", fillColor: color, fillOpacity: 0.12 }} />
              {to != null && <Polyline positions={[[node.lat, node.lon], destinationPoint(node.lat, node.lon, to, 8)]} pathOptions={{ color: "#22d3ee", weight: 2, dashArray: "5 8", opacity: 0.8 }} />}
            </>
          )}
          {!surge && from != null && to != null && (
            <Polyline positions={[[node.lat, node.lon], destinationPoint(node.lat, node.lon, to, 3)]} pathOptions={{ color: "#22d3ee", weight: 2, dashArray: "5 8", opacity: 0.55 }} />
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
          <span><MapPin size={13} /> {from == null ? "Waiting for device wind-potentiometer reading" : `${simulator ? "SIMULATOR" : "DEVICE VANE"} · FROM ${compassDirection(from)} ${from.toFixed(1)}° · ADC ${windRaw ?? "—"} / 4095`}</span>
          <span>{surge && fusion?.wind ? `UPWIND SECTOR ±${fusion.wind.sector_halfwidth_deg}° · ` : ""}{to == null ? "Wind-flow direction unavailable" : `FLOW → ${compassDirection(to)} ${to.toFixed(1)}°`}{surge && fusion?.wind ? ` · ${fusion.wind.speed_ms == null ? "wind speed unavailable" : `${fusion.wind.speed_ms.toFixed(1)} m/s`}` : ""}</span>
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
        {surge && <span><i className="legend-cone" /> Upwind sector</span>}
        {sources.length > 0 && <span><i className="legend-source" /> {simulator ? "Scenario source" : "Verified source"}</span>}
        <small>{simulator ? "Scenario locations are illustrative." : "Only verified source coordinates are shown."}</small>
      </div>
    </Panel>
  );
}

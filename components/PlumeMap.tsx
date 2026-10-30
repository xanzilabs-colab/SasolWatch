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
import { buildCone, destinationPoint } from "@/lib/geo";
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

function FitMap({ node, fusion, active }: { node: NodeRow | null; fusion: Fusion | null; active: boolean }) {
  const map = useMap();
  const from = fusion?.wind.from_deg;
  const halfWidth = fusion?.wind.sector_halfwidth_deg;
  useEffect(() => {
    const lat = node?.lat ?? -26.8167;
    const lon = node?.lon ?? 27.8167;
    if (active && from != null && halfWidth != null) {
      const bounds = L.latLngBounds([
        [lat, lon],
        ...buildCone(lat, lon, from, halfWidth, 8),
      ]);
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13, animate: true });
    } else {
      map.setView([lat, lon], 13, { animate: true });
    }
  }, [active, from, halfWidth, map, node?.lat, node?.lon]);
  return null;
}

export default function PlumeMap({
  node,
  sources,
  fusion,
  simulator,
}: {
  node: NodeRow | null;
  sources: SourceRow[];
  fusion: Fusion | null;
  simulator: boolean;
}) {
  const [mapReady, setMapReady] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [particleTick, setParticleTick] = useState(0);
  const lat = node?.lat ?? -26.8167;
  const lon = node?.lon ?? 27.8167;
  const surge = Boolean(fusion?.surge);
  const color = severityColor[fusion?.severity ?? "none"];

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
    if (!motionEnabled || !surge) return;
    const timer = window.setInterval(() => setParticleTick((tick) => tick + 1), 900);
    return () => window.clearInterval(timer);
  }, [motionEnabled, surge]);

  const cone = fusion?.wind
    ? buildCone(lat, lon, fusion.wind.from_deg, fusion.wind.sector_halfwidth_deg, 8)
    : [];
  const particleCount = surge ? Math.min(20, 4 + Math.round((fusion?.intensity ?? 0) * 28)) : 0;
  const particles = Array.from({ length: particleCount }, (_, index) => {
    const progress = ((index / Math.max(1, particleCount)) + (particleTick * 0.035 * Math.max(0.5, fusion?.wind.speed_ms ?? 1))) % 1;
    const alongKm = -7 + progress * 14;
    const point = alongKm < 0
      ? destinationPoint(lat, lon, fusion?.wind.from_deg ?? 0, Math.abs(alongKm))
      : destinationPoint(lat, lon, fusion?.wind.to_deg ?? 180, alongKm);
    return { point, key: `${index}-${particleTick}` };
  });

  const nodeIcon = useMemo(() => L.divIcon({
    className: "",
    html: `<div class="map-node" style="--node-color:${color}"><span></span><label>${escapeHtml(node?.name ?? "SasolSniff node")}</label></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  }), [color, node?.name]);

  return (
    <Panel title="Live plume map" eyebrow="SASOLBURG · 26.82°S 27.82°E" className="map-panel" simulated={simulator}>
      <div className="map-frame">
        {mapReady ? <MapContainer center={[lat, lon]} zoom={13} zoomControl={false} scrollWheelZoom className="leaflet-map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitMap node={node} fusion={fusion} active={surge} />
          <Marker position={[lat, lon]} icon={nodeIcon}>
            <Tooltip direction="top" offset={[0, -6]}>{node?.name ?? "SasolSniff node"}</Tooltip>
          </Marker>
          {surge && cone.length > 0 && (
            <>
              <Polygon positions={cone} pathOptions={{ color, weight: 2, dashArray: "7 7", fillColor: color, fillOpacity: 0.12 }} />
              <Polyline positions={[[lat, lon], destinationPoint(lat, lon, fusion!.wind.to_deg, 8)]} pathOptions={{ color: "#22d3ee", weight: 2, dashArray: "5 8", opacity: 0.8 }} />
            </>
          )}
          {!surge && fusion?.wind && (
            <Polyline positions={[[lat, lon], destinationPoint(lat, lon, fusion.wind.to_deg, 3)]} pathOptions={{ color: "#22d3ee", weight: 2, dashArray: "5 8", opacity: 0.35 }} />
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
                {surge && candidate && <Polyline positions={[[lat, lon], [source.lat, source.lon]]} pathOptions={{ color, weight: 1, dashArray: "3 6", opacity: 0.45 }} />}
                <Marker position={[source.lat, source.lon]} icon={sourceIcon}>
                  <Tooltip direction="top">
                    <b>{source.name}</b><br />
                    {candidate ? `${candidate.bearing_deg}° · ${candidate.distance_km} km · ETA ${candidate.eta_min} min` : source.kind}
                    {source.illustrative ? " · Illustrative" : ""}
                  </Tooltip>
                </Marker>
              </Fragment>
            );
          })}
          {motionEnabled && particles.map(({ point, key }) => (
            <CircleMarker key={key} center={point} radius={2.5} pathOptions={{ color, fillColor: color, fillOpacity: 0.85, weight: 0 }} />
          ))}
          {surge && fusion?.wind && (
            <Marker position={destinationPoint(lat, lon, fusion.wind.from_deg, 7.7)} icon={L.divIcon({ className: "map-tip", html: `<span>ORIGIN SECTOR · ${escapeHtml(fusion.wind.compass_from)}</span>`, iconAnchor: [0, 0] })} />
          )}
          <ZoomControl position="bottomright" />
        </MapContainer> : <div className="leaflet-map" />}
        <div className="map-compass" aria-hidden="true"><ArrowUpRight size={20} /><span>N</span></div>
        <div className="map-footer">
          <span><MapPin size={13} /> {surge ? `Origin sector ${fusion?.wind.compass_from} ±${fusion?.wind.sector_halfwidth_deg}°` : "Monitoring area"}</span>
          {surge && fusion?.wind && <span>PLUME → {fusion.wind.compass_to} · {fusion.wind.speed_ms.toFixed(1)} m/s</span>}
        </div>
        {sources.length === 0 && (
          <div className="map-data-notice">
            No source locations loaded. Run <code>supabase/schema.sql</code> in the Supabase SQL Editor to add illustrative demo points.
          </div>
        )}
        {simulator && <div className="sim-watermark" aria-hidden="true">SIMULATED — NOT FROM DEVICE</div>}
      </div>
      <div className="map-legend"><span><i className="legend-node" /> Node</span><span><i className="legend-source" /> Source position</span><span><i className="legend-cone" /> Upwind cone</span><small>Source positions are illustrative.</small></div>
    </Panel>
  );
}

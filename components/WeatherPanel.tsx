"use client";

import { useEffect, useState } from "react";
import { CloudRain, Droplets, Gauge, Wind } from "lucide-react";
import { Panel } from "./Panel";
import type { Fusion, NodeRow, WeatherData } from "@/lib/types";
import { compassDirection } from "@/lib/geo";

export function WeatherPanel({ fusion, node, simulated, deviceWindFrom }: { fusion: Fusion | null; node: NodeRow | null; simulated: boolean; deviceWindFrom?: number | null }) {
  const [fallback, setFallback] = useState<WeatherData | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const lat = node?.lat;
  const lon = node?.lon;
  useEffect(() => {
    if (simulated || fusion?.weather || lat == null || lon == null) return;
    const controller = new AbortController();
    fetch(`/api/weather?lat=${lat}&lon=${lon}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Weather unavailable");
        return result as WeatherData;
      })
      .then(setFallback)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") setFailedMessage(error.message);
      });
    return () => controller.abort();
  }, [fusion?.weather, lat, lon, simulated]);

  const weather = fusion?.weather ?? fallback;
  const vane = deviceWindFrom ?? fusion?.wind.from_deg;
  const realWind = weather?.wind_dir_deg;
  return (
    <Panel title="Local weather" eyebrow="OPENWEATHER" simulated={simulated}>
      {!weather ? (
        <div className="empty-state">{failedMessage ?? "Fetching current local conditions…"}</div>
      ) : (
        <>
          <div className="weather-compass-row">
            <div className="weather-compass" aria-label="Wind direction comparison">
              <span className="compass-north">N</span>
              {vane != null && <i className="compass-needle vane-needle" style={{ transform: `translate(-50%, -50%) rotate(${vane}deg)` }} />}
              {realWind != null && <i className="compass-needle real-needle" style={{ transform: `translate(-50%, -50%) rotate(${realWind}deg)` }} />}
              <span className="compass-center" />
            </div>
            <div className="weather-wind-value"><small>WIND SPEED</small><strong>{weather.wind_speed_ms?.toFixed(1) ?? "—"}<i> m/s</i></strong><span>gusts {weather.wind_gust_ms?.toFixed(1) ?? "—"} m/s</span></div>
          </div>
          <p className="compass-caption">Device potentiometer vs local weather-station wind</p>
          <div className="weather-legend"><span><i className="legend-vane" /> Device: {vane == null ? "—" : `${compassDirection(vane)} ${vane.toFixed(1)}°`}</span><span><i className="legend-real" /> {weather.source === "openweather" ? "OpenWeather" : weather.source ?? "Weather provider"}</span>
            {weather.vane_vs_weather_diff_deg != null && <b>{weather.vane_vs_weather_diff_deg}° difference</b>}
          </div>
          <div className="weather-grid">
            <div><Droplets size={14} /><small>HUMIDITY</small><b>{weather.humidity_pct ?? "—"}%</b></div>
            <div><CloudRain size={14} /><small>PRECIPITATION</small><b>{weather.precipitation_mm ?? "—"} mm</b></div>
            <div><Gauge size={14} /><small>PRESSURE</small><b>{weather.pressure_hpa ?? "—"} hPa</b></div>
            <div><Wind size={14} /><small>LOCAL WIND</small><b>{realWind == null ? "—" : `${compassDirection(realWind)} ${Math.round(realWind)}°`}</b></div>
          </div>
          {weather.stale && <small className="stale-note">Showing last cached observation.</small>}
        </>
      )}
      <p className="weather-footer">Weather data provided by OpenWeather. Device wind direction remains the potentiometer reading.</p>
    </Panel>
  );
}

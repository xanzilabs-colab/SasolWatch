"use client";

import { Play, RotateCcw, Square, X } from "lucide-react";
import type { SimulatorScenario, SimulatorSettings } from "@/lib/simulator";

const options: { value: SimulatorScenario; label: string }[] = [
  { value: "industrial_plume", label: "Industrial plume" },
  { value: "household_burning", label: "Household burning" },
  { value: "traffic", label: "Traffic" },
  { value: "open_burning", label: "Open burning" },
];
const scenarioDefaults: Record<SimulatorScenario, { windFrom: number; temperature?: number }> = {
  industrial_plume: { windFrom: 330 },
  household_burning: { windFrom: 140, temperature: 8 },
  traffic: { windFrom: 90 },
  open_burning: { windFrom: 140 },
};

export function SimulatorDrawer({
  open,
  running,
  settings,
  onSettings,
  onStart,
  onStop,
  onExit,
  onClose,
}: {
  open: boolean;
  running: boolean;
  settings: SimulatorSettings;
  onSettings: (settings: SimulatorSettings) => void;
  onStart: () => void;
  onStop: () => void;
  onExit: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const update = (patch: Partial<SimulatorSettings>) => onSettings({ ...settings, ...patch });
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="side-drawer simulator-drawer" role="dialog" aria-modal="true" aria-labelledby="sim-title">
        <header className="drawer-header"><div><p className="eyebrow">BACKUP MODE · NO DEVICE WRITES</p><h2 id="sim-title">Simulator controls</h2></div><button className="icon-button" onClick={onClose} aria-label="Close drawer"><X /></button></header>
        <div className="drawer-scroll">
          <div className="simulator-warning"><strong>SIMULATED — NOT FROM DEVICE</strong><p>Uses the same local fusion rules. Nothing is written to Supabase.</p></div>
          <label className="form-field">Scenario<select value={settings.scenario} onChange={(event) => {
            const scenario = event.target.value as SimulatorScenario;
            onSettings({ ...settings, scenario, ...scenarioDefaults[scenario] });
          }}>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label className="form-field">Intensity <b>{Math.round(settings.intensity * 100)}%</b><input type="range" min="0.1" max="1" step="0.05" value={settings.intensity} onChange={(event) => update({ intensity: Number(event.target.value) })} /></label>
          <label className="form-field">Wind from <b>{settings.windFrom}°</b><input type="range" min="0" max="360" step="5" value={settings.windFrom} onChange={(event) => update({ windFrom: Number(event.target.value) })} /><small>Drag to rotate the source sector.</small></label>
          <label className="form-field">Humidity <b>{settings.humidity}%</b><input type="range" min="10" max="95" step="1" value={settings.humidity} onChange={(event) => update({ humidity: Number(event.target.value) })} /></label>
          <label className="form-field">Temperature <b>{settings.temperature}°C</b><input type="range" min="-2" max="42" step="1" value={settings.temperature} onChange={(event) => update({ temperature: Number(event.target.value) })} /></label>
          <label className="rain-toggle"><input type="checkbox" checked={settings.rain} onChange={(event) => update({ rain: event.target.checked })} /><span>Simulate rain</span></label>
          <div className="simulator-actions">
            {!running ? <button className="primary-button" onClick={onStart}><Play size={15} /> Start scenario</button> : <button className="danger-button" onClick={onStop}><Square size={14} /> Stop simulator</button>}
            <button className="secondary-button" onClick={() => update({ ...settings, intensity: 0.65, humidity: 45, temperature: 22, rain: false })}><RotateCcw size={14} /> Reset controls</button>
            <button className="secondary-button" onClick={onExit}>Exit simulator</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

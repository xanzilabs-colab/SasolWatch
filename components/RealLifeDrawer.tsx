"use client";

import { X } from "lucide-react";

const steps = [
  ["01", "Sensor node", "Samples the air and reports gas response, temperature, humidity and wind."],
  ["02", "Data fusion", "Combines sensor readings, vane direction and local weather."],
  ["03", "Source mapping", "Checks the upwind cone against known source locations."],
  ["04", "Classification", "Estimates a likely source type from transparent rules."],
  ["05", "Early warning", "WhatsApp previews can notify schools, homes and response teams."],
  ["06", "Investigation report", "Shares evidence and context with municipal investigators."],
];

const comparison = [
  ["Air sensing", "Low-cost gas / smoke proxy sensor", "Calibrated particle and electrochemical gas sensors"],
  ["Wind", "Potentiometer vane (demo)", "Node anemometer and vane plus weather data"],
  ["Pollutant values", "Simulated from sensor rise", "Measured per pollutant and calibrated"],
  ["Source locations", "Illustrative placeholders", "Verified licensed-facility and emissions data"],
  ["Network", "One node", "Many nodes with intersecting bearings"],
  ["Result", "Estimate for investigation", "Evidence to prioritise inspections, never proof alone"],
];

export function RealLifeDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="side-drawer" role="dialog" aria-modal="true" aria-labelledby="real-life-title">
        <header className="drawer-header"><div><p className="eyebrow">PROTOTYPE → DEPLOYMENT</p><h2 id="real-life-title">How it works in real life</h2></div><button className="icon-button" onClick={onClose} aria-label="Close drawer"><X /></button></header>
        <div className="drawer-scroll">
          <div className="flow-list">{steps.map(([number, title, copy]) => <article key={number}><span>{number}</span><div><strong>{title}</strong><p>{copy}</p></div></article>)}</div>
          <h3 className="comparison-title">Prototype today vs real deployment</h3>
          <div className="comparison-wrap"><table className="comparison-table"><thead><tr><th>Part</th><th>Prototype today</th><th>Real deployment</th></tr></thead><tbody>{comparison.map(([part, today, future]) => <tr key={part}><th>{part}</th><td>{today}</td><td>{future}</td></tr>)}</tbody></table></div>
          <p className="drawer-disclaimer">This prototype estimates patterns for investigation. It does not identify a chemical or prove a source.</p>
        </div>
      </aside>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardCheck } from "lucide-react";
import type { ReadingRow } from "@/lib/types";

const checklist = [
  "Baseline settled", "Fan only — no false alarm", "Spray response", "Smoke response",
  "Lighter gas response", "Test-surge button", "Alert preview", "Weather comparison",
];
type Rehearsal = { stimulus: string; peakRise: number; secondsToPeak: number; secondsToRecover: number | null };
const checklistKey = "sasolsniff-demo-checklist";
const rehearsalKey = "sasolsniff-rehearsal";

export function DemoPlaybook({ latest }: { latest: ReadingRow | null }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [rows, setRows] = useState<Rehearsal[]>([]);
  const run = useRef<{ started: number; peak: number; peakAt: number } | null>(null);
  const lastId = useRef<string | number | null>(null);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const savedChecks = localStorage.getItem(checklistKey);
        const savedRows = localStorage.getItem(rehearsalKey);
        if (savedChecks) setChecked(JSON.parse(savedChecks) as string[]);
        if (savedRows) setRows(JSON.parse(savedRows) as Rehearsal[]);
      } catch (error) {
        console.error("Could not restore demo playbook state", error);
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    if (!latest || latest.id === lastId.current) return;
    lastId.current = latest.id;
    const rise = latest.fusion?.rise ?? latest.gas_raw - (latest.baseline_raw ?? latest.gas_raw);
    const threshold = latest.fusion?.threshold ?? 150;
    const now = Date.parse(latest.ts);
    if (!run.current && rise > threshold) run.current = { started: now, peak: rise, peakAt: now };
    else if (run.current && rise > run.current.peak) {
      run.current.peak = rise;
      run.current.peakAt = now;
    } else if (run.current && rise < threshold * 0.6) {
      const entry: Rehearsal = {
        stimulus: "Live sensor response",
        peakRise: run.current.peak,
        secondsToPeak: Math.max(0, Math.round((run.current.peakAt - run.current.started) / 1000)),
        secondsToRecover: Math.max(0, Math.round((now - run.current.peakAt) / 1000)),
      };
      setRows((current) => {
        const next = [entry, ...current].slice(0, 12);
        try { localStorage.setItem(rehearsalKey, JSON.stringify(next)); } catch (error) { console.error("Could not save rehearsal data", error); }
        return next;
      });
      run.current = null;
    }
  }, [latest]);

  const toggle = (item: string) => {
    setChecked((current) => {
      const next = current.includes(item) ? current.filter((value) => value !== item) : [...current, item];
      try { localStorage.setItem(checklistKey, JSON.stringify(next)); } catch (error) { console.error("Could not save demo checklist", error); }
      return next;
    });
  };

  return (
    <section className="playbook-panel">
      <button className="playbook-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><ClipboardCheck size={18} /><b>Demo playbook</b><small>{checked.length}/{checklist.length} checks</small></span><ChevronDown className={open ? "chevron-open" : ""} size={16} />
      </button>
      {open && <div className="playbook-content">
        <div className="checklist-grid">{checklist.map((item) => <label key={item} className={checked.includes(item) ? "checked" : ""}><input type="checkbox" checked={checked.includes(item)} onChange={() => toggle(item)} /><span><Check size={12} /></span>{item}</label>)}</div>
        <div className="rehearsal-table-wrap"><table className="rehearsal-table"><thead><tr><th>Stimulus</th><th>Peak rise</th><th>To peak</th><th>Recovery</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={4}>Live rehearsal metrics will be recorded from sensor data.</td></tr> : rows.map((row, index) => <tr key={`${row.peakRise}-${index}`}><td>{row.stimulus}</td><td>{row.peakRise.toLocaleString()}</td><td>{row.secondsToPeak}s</td><td>{row.secondsToRecover == null ? "—" : `${row.secondsToRecover}s`}</td></tr>)}</tbody></table></div>
      </div>}
    </section>
  );
}

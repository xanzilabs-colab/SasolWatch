import { ArrowUpRight, Factory, Home, Pickaxe, Route, Zap } from "lucide-react";
import { Panel } from "./Panel";
import type { Fusion } from "@/lib/types";

const icons = { industrial: Factory, power: Zap, mine: Pickaxe, waste_treatment: Factory, residential: Home, road: Route };

export function CandidateList({ fusion, active, simulated, sourceCount }: { fusion: Fusion | null; active: boolean; simulated: boolean; sourceCount: number }) {
  const candidates = active ? (fusion?.candidates ?? []) : [];
  return (
    <Panel title="Candidate sources" eyebrow="UPWIND SECTOR" simulated={simulated}>
      <p className="panel-caption">{simulated ? "Illustrative source positions for this scenario." : "Verified coordinates only. Candidates are hypotheses, not confirmed causes."}</p>
      {!sourceCount ? <div className="empty-state">{simulated ? "No scenario source locations are configured." : "No verified source coordinates are registered; source attribution is unavailable."}</div> : !active ? <div className="empty-state">Candidates appear during an active surge.</div> : candidates.length === 0 ? (
        <div className="empty-state">{simulated ? "No illustrative sources in the current upwind cone." : "No verified source location falls within the current upwind sector."}</div>
      ) : (
        <div className="candidate-list">
          {candidates.map((candidate) => {
            const Icon = icons[candidate.kind] ?? Factory;
            return (
              <article className="candidate-row" key={candidate.id}>
                <span className="candidate-icon"><Icon size={16} /></span>
                <div className="candidate-copy">
                  <strong>{candidate.name}</strong>
                  <small>{candidate.kind.replaceAll("_", " ")} · bearing {candidate.bearing_deg}° · {candidate.distance_km.toFixed(1)} km</small>
                  <small>{candidate.eta_min == null ? "Travel time unavailable: no wind-speed reading." : `Estimated travel time ${candidate.eta_min} min at ${fusion?.wind.speed_ms?.toFixed(1)} m/s`}</small>
                  {candidate.illustrative && <span className="illustrative-tag">ILLUSTRATIVE</span>}
                </div>
                <span className="candidate-score">{Math.round(candidate.score * 100)}<small>%</small><ArrowUpRight size={13} /></span>
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

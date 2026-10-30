export interface SurgeSample {
  ts: string;
  gas_raw: number;
  baseline_raw: number | null;
}

export interface SurgeEvaluation {
  rise: number;
  threshold: number;
  score: number;
  streak: number;
  surge: boolean;
  severityRank: number;
}

export const SURGE_SCORE_THRESHOLD = 60;
export const SURGE_MIN_STREAK = 3;
const MAX_SAMPLE_GAP_MS = 5_000;

export function evaluateSurge(input: {
  gas: number;
  baseline: number;
  ts: string;
  previous: SurgeSample[];
  warming: boolean;
  deviceSurge: boolean;
}): SurgeEvaluation {
  const rise = input.gas - input.baseline;
  const threshold = Math.max(150, input.baseline * 0.25);
  const elevated = rise > threshold;
  let streak = elevated ? 1 : 0;
  let nextTimestamp = Date.parse(input.ts);

  if (elevated && Number.isFinite(nextTimestamp)) {
    for (const sample of [...input.previous].reverse()) {
      const sampleTimestamp = Date.parse(sample.ts);
      if (!Number.isFinite(sampleTimestamp) || nextTimestamp - sampleTimestamp <= 0 ||
        nextTimestamp - sampleTimestamp > MAX_SAMPLE_GAP_MS || sample.baseline_raw == null ||
        !Number.isFinite(sample.gas_raw) || !Number.isFinite(sample.baseline_raw)) break;

      const sampleThreshold = Math.max(150, sample.baseline_raw * 0.25);
      if (sample.gas_raw - sample.baseline_raw <= sampleThreshold) break;

      streak += 1;
      nextTimestamp = sampleTimestamp;
    }
  }

  const magnitudeScore = Math.min(1, Math.max(0, (rise / threshold - 1) / 2)) * 40;
  const persistenceScore = Math.min(streak, SURGE_MIN_STREAK) / SURGE_MIN_STREAK * 50;
  const deviceCorroboration = input.deviceSurge ? 10 : 0;
  const score = Math.round(Math.min(100, magnitudeScore + persistenceScore + deviceCorroboration));
  const surge = !input.warming && streak >= SURGE_MIN_STREAK && score >= SURGE_SCORE_THRESHOLD;
  const severityRank = !surge ? 0 : score < 65 ? 1 : score < 78 ? 2 : score < 90 ? 3 : 4;

  return {
    rise: Math.round(rise),
    threshold: Math.round(threshold),
    score,
    streak,
    surge,
    severityRank,
  };
}

import type { StrategistEvaluation } from "./schemas";

export const STRATEGY_WEIGHTS = {
  strategic_fit: 0.25,
  audience_relevance: 0.2,
  credibility: 0.2,
  conversation_potential: 0.15,
  originality: 0.1,
  memorability: 0.1,
} as const;

export const PENALTY_WEIGHTS = {
  genericness: 0.12,
  hype: 0.1,
  weak_evidence: 0.08,
  repetition: 0.08,
  weak_axelyn_connection: 0.12,
} as const;

export function calculateStrategistScore(evaluation: StrategistEvaluation): number {
  const base = Object.entries(STRATEGY_WEIGHTS).reduce(
    (total, [key, weight]) => total + evaluation.component_scores[key as keyof typeof STRATEGY_WEIGHTS] * weight,
    0,
  );

  const penalty = Object.entries(PENALTY_WEIGHTS).reduce(
    (total, [key, weight]) => total + evaluation.penalties[key as keyof typeof PENALTY_WEIGHTS] * weight,
    0,
  );

  return Math.max(0, Math.min(100, Math.round(base - penalty)));
}

import type { Candidate, CriticEvaluation, ScoutOutput } from "@/domain/schemas";
import { editorialGuardrails, taxonomyGuide } from "./shared";

export interface StrategyCandidate {
  candidate_ref: string;
  candidate: Candidate;
  critique: CriticEvaluation;
}

export const strategistSystemPrompt = `You are Strategist, a bounded business-editorial evaluator for Axelyn Technologies.

Optimize for this progression, not raw virality: Attention → Recognition → Credibility → Familiarity → Conversation → Opportunity.

For each surviving candidate, produce a publication-ready editorial brief (not a full post), assign component scores, assess penalties, and choose readiness. Each brief must have exactly one primary job and it must match the candidate taxonomy.

Component scores (0–100, higher is better): strategic fit, audience relevance, credibility, conversation potential, originality, memorability. The application applies weights of 25%, 20%, 20%, 15%, 10%, and 10%; do not calculate the final score yourself.

Penalty severity scores (0–100, higher is worse): genericness, hype, weak evidence, repetition, weak Axelyn connection. Be demanding. READY means the claim can responsibly be developed now. NEEDS_EVIDENCE means specific proof is missing. NEEDS_REWORK means the framing still needs editorial work. HOLD means strategically mistimed. KILLED is allowed only if a serious issue survived Critic.

${taxonomyGuide}

${editorialGuardrails}

The LinkedIn and Threads fields describe how the angle should change for each platform; they are not finished posts or hooks. Evaluate every provided survivor exactly once. The structured output's evaluations object is keyed by the short candidate_ref values; preserve those keys exactly.`;

export function strategistUserPrompt(
  scout: ScoutOutput,
  candidates: StrategyCandidate[],
  context: unknown,
): string {
  return `AXELYN STRATEGIC CONTEXT:
${JSON.stringify(context, null, 2)}

SOURCE SIGNAL:
${JSON.stringify({ signal: scout.signal, change: scout.change, tension: scout.tension, audiences: scout.audiences }, null, 2)}

SURVIVING CANDIDATES WITH CRITIQUE:
${JSON.stringify(candidates, null, 2)}

Return only the requested structured Strategist output. Fill every candidate_ref key exactly once and do not create candidates that were not provided.`;
}

import type { Candidate, ScoutOutput } from "@/domain/schemas";
import { editorialGuardrails } from "./shared";

export const criticSystemPrompt = `You are Critic, an adversarial editorial reviewer for Axelyn Technologies. You use a different model family from Explorer and independently attack every candidate.

For each candidate ask: Is it generic or obvious? Does it resemble common LinkedIn AI commentary? Is the claim defensible? Does Axelyn have credibility? Would the audience care? Is there actual tension? Does it overpromise? Is there a meaningful counterargument? Is there hype? What evidence is required?

${editorialGuardrails}

Scores are integers from 0 to 100. For genericness, strategic_risk, and hype, higher is worse; for originality, credibility, and audience_relevance, higher is better. Use KILL decisively: KILL ideas that are generic beyond repair, indefensible, irrelevant, or outside Axelyn's credible experience. Use REWORK when the underlying thought is useful but the framing is weak. Evaluate every provided candidate exactly once and preserve its candidate_id.`;

export function criticUserPrompt(
  scout: ScoutOutput,
  candidates: Candidate[],
  context: unknown,
): string {
  return `AXELYN REVIEW CONTEXT:
${JSON.stringify(context, null, 2)}

SOURCE SIGNAL SUMMARY:
${JSON.stringify({ signal: scout.signal, tension: scout.tension, business_implications: scout.business_implications }, null, 2)}

CANDIDATES TO ATTACK:
${JSON.stringify(candidates, null, 2)}

Return only the requested structured Critic output. Include one evaluation per candidate.`;
}

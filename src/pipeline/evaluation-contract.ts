import { z } from "zod";
import {
  CriticEvaluationSchema,
  CriticOutputSchema,
  StrategistEvaluationSchema,
  StrategistOutputSchema,
  type Candidate,
  type CriticOutput,
  type StrategistOutput,
} from "@/domain/schemas";

const CriticEvaluationBodySchema = CriticEvaluationSchema.omit({ candidate_id: true });
const StrategistEvaluationBodySchema = StrategistEvaluationSchema.omit({ candidate_id: true });

export function candidateReference(index: number): string {
  return `C${String(index + 1).padStart(2, "0")}`;
}

function referencedEvaluationsSchema<T extends z.ZodType>(
  candidateCount: number,
  evaluationSchema: T,
) {
  if (candidateCount < 1) {
    throw new Error("At least one candidate is required for evaluation.");
  }

  const evaluations = Object.fromEntries(
    Array.from({ length: candidateCount }, (_, index) => [
      candidateReference(index),
      evaluationSchema,
    ]),
  ) as Record<string, T>;

  return z.object({
    evaluations: z.object(evaluations).strict(),
  }).strict();
}

export function criticEvaluationRequestSchema(candidates: Candidate[]) {
  return referencedEvaluationsSchema(candidates.length, CriticEvaluationBodySchema);
}

export function strategistEvaluationRequestSchema(candidates: Candidate[]) {
  return referencedEvaluationsSchema(candidates.length, StrategistEvaluationBodySchema);
}

function restoreCandidateIds<T extends object>(
  candidates: Candidate[],
  evaluations: Record<string, T>,
): Array<T & { candidate_id: string }> {
  return candidates.map((candidate, index) => ({
    candidate_id: candidate.id,
    ...evaluations[candidateReference(index)],
  }));
}

export function restoreCriticCandidateIds(
  candidates: Candidate[],
  evaluations: Record<string, z.infer<typeof CriticEvaluationBodySchema>>,
): CriticOutput {
  return CriticOutputSchema.parse({
    evaluations: restoreCandidateIds(candidates, evaluations),
  });
}

export function restoreStrategistCandidateIds(
  candidates: Candidate[],
  evaluations: Record<string, z.infer<typeof StrategistEvaluationBodySchema>>,
): StrategistOutput {
  return StrategistOutputSchema.parse({
    evaluations: restoreCandidateIds(candidates, evaluations),
  });
}

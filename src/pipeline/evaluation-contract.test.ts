import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Candidate } from "@/domain/schemas";
import {
  candidateReference,
  criticEvaluationRequestSchema,
  restoreCriticCandidateIds,
  strategistEvaluationRequestSchema,
} from "./evaluation-contract";

const candidates: Candidate[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    taxonomy: "THINK",
    core_idea: "Decision quality becomes more valuable as code becomes cheaper.",
    tension: "Faster delivery can amplify a bad choice.",
    intended_audience: ["founders", "CTOs"],
    reader_payoff: "Reframes AI coding as a decision problem.",
    why_interesting: "It relocates the engineering bottleneck.",
    axelyn_connection: "Requirements-to-production experience.",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    taxonomy: "TEACH",
    core_idea: "Shorter build cycles need shorter validation loops.",
    tension: "Feedback can remain slow while coding accelerates.",
    intended_audience: ["product leaders"],
    reader_payoff: "Connects engineering speed to validation practice.",
    why_interesting: "The two loops do not automatically accelerate together.",
    axelyn_connection: "Delivery and product translation experience.",
  },
];

const evaluation = {
  originality: 78,
  credibility: 85,
  audience_relevance: 82,
  genericness: 15,
  strategic_risk: 12,
  hype: 3,
  claim_defensible: true,
  meaningful_counterargument: "Fast iteration may make mistakes cheaper to reverse.",
  evidence_requirement: "LIGHT" as const,
  evidence_needed: ["A concrete delivery example"],
  risks: [],
  recommendation: "KEEP" as const,
  reasoning: "Specific and credible enough to develop.",
};

describe("candidate-bound evaluation contract", () => {
  it("uses stable, compact references", () => {
    expect(candidateReference(0)).toBe("C01");
    expect(candidateReference(11)).toBe("C12");
  });

  it("requires exactly one critic evaluation for each candidate reference", () => {
    const schema = criticEvaluationRequestSchema(candidates);
    const valid = {
      evaluations: {
        C01: evaluation,
        C02: { ...evaluation, recommendation: "REWORK" as const },
      },
    };

    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ evaluations: { C01: evaluation } }).success).toBe(false);
    expect(schema.safeParse({
      evaluations: { C01: evaluation, C99: evaluation },
    }).success).toBe(false);
  });

  it("publishes every reference as a required structured-output key for both stages", () => {
    for (const schema of [
      criticEvaluationRequestSchema(candidates),
      strategistEvaluationRequestSchema(candidates),
    ]) {
      expect(z.toJSONSchema(schema, { target: "draft-7" })).toMatchObject({
        properties: {
          evaluations: {
            required: ["C01", "C02"],
            additionalProperties: false,
          },
        },
      });
    }
  });

  it("reattaches trusted internal IDs after model output validation", () => {
    const output = restoreCriticCandidateIds(candidates, {
      C01: evaluation,
      C02: { ...evaluation, recommendation: "REWORK" },
    });

    expect(output.evaluations.map(({ candidate_id }) => candidate_id)).toEqual(
      candidates.map(({ id }) => id),
    );
  });
});

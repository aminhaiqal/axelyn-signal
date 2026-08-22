import { describe, expect, it } from "vitest";
import type { StrategistEvaluation } from "./schemas";
import { calculateStrategistScore } from "./scoring";

const evaluation: StrategistEvaluation = {
  candidate_id: "candidate-1",
  title: "Decision quality becomes the bottleneck",
  primary_job: "THINK",
  target_audience: ["founders", "CTOs"],
  core_claim: "Faster implementation increases the value of deciding well.",
  why_people_care: "Teams can waste less time while wasting more capital.",
  axelyn_right_to_speak: "Axelyn translates business requirements into production systems.",
  reader_takeaway: "Improve decision quality alongside delivery speed.",
  counterargument: "Faster iteration can also make wrong decisions cheaper to reverse.",
  evidence_needed: [],
  linkedin_angle: "Use a delivery tradeoff and practical decision framework.",
  threads_angle: "Break the tension into a concise sequence of observations.",
  recommended_platform: "BOTH",
  readiness_status: "READY",
  component_scores: {
    strategic_fit: 90,
    audience_relevance: 80,
    credibility: 85,
    conversation_potential: 70,
    originality: 75,
    memorability: 80,
  },
  penalties: {
    genericness: 10,
    hype: 0,
    weak_evidence: 5,
    repetition: 0,
    weak_axelyn_connection: 0,
  },
  strategic_reasoning: "Strong fit with a modest evidence burden.",
};

describe("calculateStrategistScore", () => {
  it("applies the documented weighted score and penalties", () => {
    expect(calculateStrategistScore(evaluation)).toBe(80);
  });

  it("clamps heavily penalized ideas to zero", () => {
    expect(calculateStrategistScore({
      ...evaluation,
      component_scores: {
        strategic_fit: 0,
        audience_relevance: 0,
        credibility: 0,
        conversation_potential: 0,
        originality: 0,
        memorability: 0,
      },
      penalties: {
        genericness: 100,
        hype: 100,
        weak_evidence: 100,
        repetition: 100,
        weak_axelyn_connection: 100,
      },
    })).toBe(0);
  });
});

import { z } from "zod";

export const TaxonomySchema = z.enum([
  "ENTERTAIN",
  "CONNECT",
  "TEACH",
  "THINK",
  "PROVE",
  "DISCUSS",
  "INSPIRE",
  "TRUST",
  "CONVERT",
]);

export const SourceTypeSchema = z.enum([
  "observation",
  "conversation",
  "project_lesson",
  "business_trend",
  "external_signal",
  "other",
]);

export const SignalInputSchema = z.object({
  source_type: SourceTypeSchema,
  content: z.string().trim().min(12, "Add a little more detail to the signal.").max(6000),
  context: z.string().trim().max(4000).optional().default(""),
});

const ScoreSchema = z.number().int().min(0).max(100);

export const ScoutOutputSchema = z.object({
  signal: z.string().min(1),
  happened: z.string().min(1),
  change: z.string().min(1),
  why_it_matters: z.string().min(1),
  tension: z.string().min(1),
  audiences: z.array(z.string().min(1)).max(8),
  business_implications: z.array(z.string().min(1)).max(8),
  questions: z.array(z.string().min(1)).max(8),
  quality: z.object({
    relevance: ScoreSchema,
    business_relevance: ScoreSchema,
    idea_potential: ScoreSchema,
  }),
  continue_pipeline: z.boolean(),
  stop_reason: z.string(),
});

export const CandidateDraftSchema = z.object({
  taxonomy: TaxonomySchema,
  core_idea: z.string().min(1),
  tension: z.string().min(1),
  intended_audience: z.array(z.string().min(1)).min(1).max(6),
  reader_payoff: z.string().min(1),
  why_interesting: z.string().min(1),
  axelyn_connection: z.string().min(1),
});

export const ExplorerOutputSchema = z.object({
  selected_taxonomies: z.array(TaxonomySchema).min(1).max(3),
  taxonomy_rationale: z.array(
    z.object({ taxonomy: TaxonomySchema, reason: z.string().min(1) }),
  ).min(1).max(3),
  candidates: z.array(CandidateDraftSchema).min(3).max(12),
});

export const CandidateSchema = CandidateDraftSchema.extend({ id: z.string().min(1) });

export const CriticRecommendationSchema = z.enum(["KEEP", "REWORK", "KILL"]);
export const EvidenceRequirementSchema = z.enum(["NONE", "LIGHT", "SUBSTANTIAL"]);

export const CriticEvaluationSchema = z.object({
  candidate_id: z.string().min(1),
  originality: ScoreSchema,
  credibility: ScoreSchema,
  audience_relevance: ScoreSchema,
  genericness: ScoreSchema,
  strategic_risk: ScoreSchema,
  hype: ScoreSchema,
  claim_defensible: z.boolean(),
  meaningful_counterargument: z.string().min(1),
  evidence_requirement: EvidenceRequirementSchema,
  evidence_needed: z.array(z.string().min(1)).max(6),
  risks: z.array(z.string().min(1)).max(6),
  recommendation: CriticRecommendationSchema,
  reasoning: z.string().min(1),
});

export const CriticOutputSchema = z.object({
  evaluations: z.array(CriticEvaluationSchema).min(1).max(12),
});

const StrategyComponentsSchema = z.object({
  strategic_fit: ScoreSchema,
  audience_relevance: ScoreSchema,
  credibility: ScoreSchema,
  conversation_potential: ScoreSchema,
  originality: ScoreSchema,
  memorability: ScoreSchema,
});

const StrategyPenaltiesSchema = z.object({
  genericness: ScoreSchema,
  hype: ScoreSchema,
  weak_evidence: ScoreSchema,
  repetition: ScoreSchema,
  weak_axelyn_connection: ScoreSchema,
});

export const ReadinessStatusSchema = z.enum([
  "READY",
  "NEEDS_EVIDENCE",
  "NEEDS_REWORK",
  "HOLD",
  "KILLED",
]);

export const StrategistEvaluationSchema = z.object({
  candidate_id: z.string().min(1),
  title: z.string().min(1).max(120),
  primary_job: TaxonomySchema,
  target_audience: z.array(z.string().min(1)).min(1).max(6),
  core_claim: z.string().min(1),
  why_people_care: z.string().min(1),
  axelyn_right_to_speak: z.string().min(1),
  reader_takeaway: z.string().min(1),
  counterargument: z.string().min(1),
  evidence_needed: z.array(z.string().min(1)).max(6),
  linkedin_angle: z.string().min(1),
  threads_angle: z.string().min(1),
  recommended_platform: z.enum(["LINKEDIN", "THREADS", "BOTH"]),
  readiness_status: ReadinessStatusSchema,
  component_scores: StrategyComponentsSchema,
  penalties: StrategyPenaltiesSchema,
  strategic_reasoning: z.string().min(1),
});

export const StrategistOutputSchema = z.object({
  evaluations: z.array(StrategistEvaluationSchema).min(1).max(12),
});

export const FinalBriefSchema = StrategistEvaluationSchema.omit({
  component_scores: true,
  penalties: true,
  readiness_status: true,
}).extend({
  rank: z.number().int().positive(),
  score: ScoreSchema,
  status: ReadinessStatusSchema,
});

export const UsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative().default(0),
  completion_tokens: z.number().int().nonnegative().default(0),
  total_tokens: z.number().int().nonnegative().default(0),
  reasoning_tokens: z.number().int().nonnegative().default(0),
  cached_tokens: z.number().int().nonnegative().default(0),
  cost: z.number().nonnegative().nullable().default(null),
  estimated_cost: z.number().nonnegative().default(0),
});

export const PipelineResultSchema = z.object({
  run_id: z.string(),
  status: z.enum(["COMPLETED", "STOPPED"]),
  scout: ScoutOutputSchema,
  briefs: z.array(FinalBriefSchema).max(5),
  usage: UsageSchema,
  models: z.record(z.string(), z.string()),
});

export type Taxonomy = z.infer<typeof TaxonomySchema>;
export type SignalInput = z.infer<typeof SignalInputSchema>;
export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;
export type CandidateDraft = z.infer<typeof CandidateDraftSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type ExplorerOutput = z.infer<typeof ExplorerOutputSchema>;
export type CriticEvaluation = z.infer<typeof CriticEvaluationSchema>;
export type CriticOutput = z.infer<typeof CriticOutputSchema>;
export type StrategistEvaluation = z.infer<typeof StrategistEvaluationSchema>;
export type StrategistOutput = z.infer<typeof StrategistOutputSchema>;
export type FinalBrief = z.infer<typeof FinalBriefSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type PipelineResult = z.infer<typeof PipelineResultSchema>;

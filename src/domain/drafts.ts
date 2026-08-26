import { z } from "zod";
import type { BufferDelivery } from "./buffer";
import type { FinalBrief, SignalInput, Usage } from "./schemas";

export const DraftPlatformSchema = z.enum(["LINKEDIN", "THREADS"]);
export const DraftSourceSchema = z.enum(["WRITER", "REPAIR", "OPERATOR"]);
export const DraftReviewStateSchema = z.enum([
  "UNCHECKED",
  "PASS",
  "REVISE",
  "NEEDS_INPUT",
  "REPAIRED",
]);
export const DraftSessionStatusSchema = z.enum([
  "RUNNING",
  "READY_FOR_REVIEW",
  "NEEDS_INPUT",
  "FAILED",
]);

export const DraftRequestSchema = z.object({
  platforms: z.array(DraftPlatformSchema).min(1).max(2).refine(
    (platforms) => new Set(platforms).size === platforms.length,
    "Choose each platform only once.",
  ),
  evidence: z.string().trim().max(6000).optional().default(""),
  guidance: z.string().trim().max(2000).optional().default(""),
});

export const DraftRepairRequestSchema = z.object({
  platform: DraftPlatformSchema,
  revision: z.number().int().positive(),
  instructions: z.string().trim().min(3, "Describe the change you want Drafter to make.").max(2000),
});

export const WriterDraftSchema = z.object({
  platform: DraftPlatformSchema,
  content: z.string().trim().min(40).max(12000),
});

export const WriterOutputSchema = z.object({
  drafts: z.array(WriterDraftSchema).min(1).max(2),
});

export const DraftReviewVerdictSchema = z.enum(["PASS", "REVISE", "NEEDS_INPUT"]);
export const DraftFindingCategorySchema = z.enum([
  "EVIDENCE",
  "BRIEF_FIDELITY",
  "AXELYN_CREDIBILITY",
  "PLATFORM_FIT",
  "CLAIM_RESTRAINT",
  "GENERICNESS",
  "LENGTH",
  "CONVERSATION_QUALITY",
]);

export const DraftFindingSchema = z.object({
  category: DraftFindingCategorySchema,
  quote: z.string().trim().max(240).default(""),
  message: z.string().trim().min(1).max(500),
  required_change: z.string().trim().min(1).max(500),
});

export const PlatformReviewSchema = z.object({
  platform: DraftPlatformSchema,
  verdict: DraftReviewVerdictSchema,
  summary: z.string().trim().min(1).max(500),
  findings: z.array(DraftFindingSchema).max(8),
});

export const DraftReviewerOutputSchema = z.object({
  reviews: z.array(PlatformReviewSchema).min(1).max(2),
});

export interface DraftSourceContext {
  run_id: string;
  candidate_id: string;
  source_type: SignalInput["source_type"];
  signal: string;
  signal_context: string;
  brief: FinalBrief;
}

export interface DraftRevision {
  id: string;
  session_id: string;
  platform: DraftPlatform;
  revision: number;
  source: DraftSource;
  content: string;
  repair_prompt: string | null;
  character_count: number;
  review_state: DraftReviewState;
  review: PlatformReview | null;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  buffer_deliveries: BufferDelivery[];
}

export interface DraftPlatformView {
  platform: DraftPlatform;
  current: DraftRevision;
  revisions: DraftRevision[];
}

export interface DraftSession {
  id: string;
  pipeline_run_id: string;
  candidate_id: string;
  requested_platforms: DraftPlatform[];
  evidence: string;
  guidance: string;
  status: DraftSessionStatus;
  models: Record<string, string>;
  usage: Usage;
  error: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  drafts: DraftPlatformView[];
}

export const PLATFORM_LIMITS: Record<DraftPlatform, number> = {
  LINKEDIN: 3000,
  THREADS: 500,
};

export function countDraftCharacters(content: string): number {
  return Array.from(content).length;
}

export type DraftPlatform = z.infer<typeof DraftPlatformSchema>;
export type DraftSource = z.infer<typeof DraftSourceSchema>;
export type DraftReviewState = z.infer<typeof DraftReviewStateSchema>;
export type DraftSessionStatus = z.infer<typeof DraftSessionStatusSchema>;
export type DraftRequest = z.infer<typeof DraftRequestSchema>;
export type DraftRepairRequest = z.infer<typeof DraftRepairRequestSchema>;
export type WriterDraft = z.infer<typeof WriterDraftSchema>;
export type WriterOutput = z.infer<typeof WriterOutputSchema>;
export type DraftReviewVerdict = z.infer<typeof DraftReviewVerdictSchema>;
export type DraftFindingCategory = z.infer<typeof DraftFindingCategorySchema>;
export type DraftFinding = z.infer<typeof DraftFindingSchema>;
export type PlatformReview = z.infer<typeof PlatformReviewSchema>;
export type DraftReviewerOutput = z.infer<typeof DraftReviewerOutputSchema>;

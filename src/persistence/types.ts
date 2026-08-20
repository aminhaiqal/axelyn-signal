import type {
  Candidate,
  CriticEvaluation,
  FinalBrief,
  ScoutOutput,
  SignalInput,
  StrategistEvaluation,
  Usage,
} from "@/domain/schemas";
import type { AgentName } from "@/config/agents";

export type RunStatus = "RUNNING" | "COMPLETED" | "STOPPED" | "FAILED";

export interface AgentRunCompletion {
  output: unknown;
  model: string;
  provider: string | null;
  generationId: string | null;
  usage: Usage;
  durationMs: number;
}

export interface RecentRun {
  id: string;
  source_type: SignalInput["source_type"];
  content: string;
  status: RunStatus;
  brief_count: number;
  total_tokens: number;
  estimated_cost: number;
  created_at: string;
}

export interface StoredRun extends RecentRun {
  context: string;
  scout: ScoutOutput | null;
  briefs: FinalBrief[];
  models: Record<string, string>;
  actual_cost: number | null;
  completed_at: string | null;
  error: string | null;
}

export interface PipelineRepository {
  createRun(id: string, input: SignalInput, models: Record<string, string>): void;
  startAgentRun(runId: string, agent: AgentName, model: string, input: unknown): string;
  completeAgentRun(agentRunId: string, completion: AgentRunCompletion): void;
  failAgentRun(agentRunId: string, error: string, durationMs: number): void;
  saveScout(runId: string, output: ScoutOutput): void;
  saveCandidates(runId: string, candidates: Candidate[]): void;
  saveCritiques(runId: string, critiques: CriticEvaluation[]): void;
  saveStrategies(runId: string, strategies: StrategistEvaluation[], scores: Map<string, number>): void;
  saveBriefs(runId: string, briefs: FinalBrief[]): void;
  finishRun(runId: string, status: "COMPLETED" | "STOPPED", usage: Usage, models: Record<string, string>): void;
  failRun(runId: string, error: string): void;
  listRuns(limit?: number): RecentRun[];
  getRun(id: string): StoredRun | null;
}

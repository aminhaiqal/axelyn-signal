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
  createRun(id: string, input: SignalInput, models: Record<string, string>): Promise<void>;
  startAgentRun(runId: string, agent: AgentName, model: string, input: unknown): Promise<string>;
  completeAgentRun(agentRunId: string, completion: AgentRunCompletion): Promise<void>;
  failAgentRun(agentRunId: string, error: string, durationMs: number): Promise<void>;
  saveScout(runId: string, output: ScoutOutput): Promise<void>;
  saveCandidates(runId: string, candidates: Candidate[]): Promise<void>;
  saveCritiques(runId: string, critiques: CriticEvaluation[]): Promise<void>;
  saveStrategies(runId: string, strategies: StrategistEvaluation[], scores: Map<string, number>): Promise<void>;
  saveBriefs(runId: string, briefs: FinalBrief[]): Promise<void>;
  finishRun(runId: string, status: "COMPLETED" | "STOPPED", usage: Usage, models: Record<string, string>): Promise<void>;
  failRun(runId: string, error: string): Promise<void>;
  listRuns(limit?: number): Promise<RecentRun[]>;
  getRun(id: string): Promise<StoredRun | null>;
}

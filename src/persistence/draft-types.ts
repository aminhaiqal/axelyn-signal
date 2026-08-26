import type { DraftAgentName } from "@/config/agents";
import type {
  DraftPlatform,
  DraftRequest,
  DraftReviewState,
  DraftSession,
  DraftSessionStatus,
  DraftSource,
  DraftSourceContext,
  PlatformReview,
} from "@/domain/drafts";
import type { Usage } from "@/domain/schemas";
import type { AgentRunCompletion } from "./types";

export interface DraftRepository {
  getBriefContext(runId: string, candidateId: string): Promise<DraftSourceContext | null>;
  createSession(
    id: string,
    source: DraftSourceContext,
    request: DraftRequest,
    models: Record<string, string>,
    createdBy: string | null,
  ): Promise<void>;
  startAgentRun(
    sessionId: string,
    agent: DraftAgentName,
    model: string,
    input: unknown,
  ): Promise<string>;
  completeAgentRun(agentRunId: string, completion: AgentRunCompletion): Promise<void>;
  failAgentRun(agentRunId: string, error: string, durationMs: number): Promise<void>;
  saveRevision(
    sessionId: string,
    platform: DraftPlatform,
    revision: number,
    source: DraftSource,
    content: string,
    reviewState: DraftReviewState,
    review: PlatformReview | null,
    createdBy: string | null,
  ): Promise<void>;
  applyReview(
    sessionId: string,
    platform: DraftPlatform,
    revision: number,
    reviewState: DraftReviewState,
    review: PlatformReview,
  ): Promise<void>;
  finishSession(
    sessionId: string,
    status: Exclude<DraftSessionStatus, "RUNNING" | "FAILED">,
    usage: Usage,
    models: Record<string, string>,
  ): Promise<void>;
  failSession(sessionId: string, error: string): Promise<void>;
  updateSessionStatus(sessionId: string, status: DraftSessionStatus): Promise<void>;
  getSession(id: string): Promise<DraftSession | null>;
  listSessions(runId: string, candidateId: string): Promise<DraftSession[]>;
  getSessionContext(id: string): Promise<DraftSourceContext | null>;
  saveOperatorRevision(
    sessionId: string,
    platform: DraftPlatform,
    content: string,
    createdBy: string | null,
  ): Promise<DraftSession | null>;
  saveRepairRevision(
    sessionId: string,
    platform: DraftPlatform,
    content: string,
    repairPrompt: string,
    createdBy: string | null,
  ): Promise<DraftSession | null>;
  deleteRevision(
    sessionId: string,
    platform: DraftPlatform,
    revisionId: string,
    deletedBy: string | null,
  ): Promise<DraftSession | null>;
  approveCurrentRevision(
    sessionId: string,
    platform: DraftPlatform,
    approvedBy: string | null,
  ): Promise<DraftSession | null>;
}

export type DraftAgentCompletion = AgentRunCompletion;

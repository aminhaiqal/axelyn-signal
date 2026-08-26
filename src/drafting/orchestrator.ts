import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  getDraftAgentConfig,
  type AgentConfig,
  type DraftAgentName,
} from "@/config/agents";
import {
  DraftRepairRequestSchema,
  DraftRequestSchema,
  DraftReviewerOutputSchema,
  PLATFORM_LIMITS,
  WriterOutputSchema,
  countDraftCharacters,
  type DraftPlatform,
  type DraftRepairRequest,
  type DraftRequest,
  type DraftReviewState,
  type DraftReviewerOutput,
  type DraftSession,
  type DraftSourceContext,
  type PlatformReview,
  type WriterDraft,
} from "@/domain/drafts";
import type { Usage } from "@/domain/schemas";
import type { CompletionResult, LlmGateway } from "@/llm/gateway";
import type { DraftRepository } from "@/persistence/draft-types";
import { draftReviewerSystemPrompt, draftReviewerUserPrompt } from "@/prompts/draft-reviewer";
import {
  drafterSystemPrompt,
  drafterUserPrompt,
  operatorRepairSystemPrompt,
  operatorRepairUserPrompt,
  repairSystemPrompt,
  repairUserPrompt,
} from "@/prompts/drafter";
import type { DraftingEventHandler } from "./events";

export interface DraftingDependencies {
  gateway: LlmGateway;
  repository: DraftRepository;
  onEvent?: DraftingEventHandler;
}

interface DraftStageRequest<T> {
  sessionId: string;
  agent: DraftAgentName;
  eventStage: DraftAgentName | "repair";
  config: AgentConfig;
  system: string;
  user: string;
  schemaName: string;
  schema: z.ZodType<T>;
  persistenceInput: unknown;
}

const emptyUsage = (): Usage => ({
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  reasoning_tokens: 0,
  cached_tokens: 0,
  cost: 0,
  estimated_cost: 0,
});

function combineUsage(total: Usage, next: Usage): Usage {
  return {
    prompt_tokens: total.prompt_tokens + next.prompt_tokens,
    completion_tokens: total.completion_tokens + next.completion_tokens,
    total_tokens: total.total_tokens + next.total_tokens,
    reasoning_tokens: total.reasoning_tokens + next.reasoning_tokens,
    cached_tokens: total.cached_tokens + next.cached_tokens,
    cost: total.cost === null || next.cost === null ? null : total.cost + next.cost,
    estimated_cost: total.estimated_cost + next.estimated_cost,
  };
}

function assertExactPlatforms(
  stage: string,
  expectedPlatforms: DraftPlatform[],
  returned: Array<{ platform: DraftPlatform }>,
): void {
  const expected = new Set(expectedPlatforms);
  const received = new Set(returned.map((item) => item.platform));
  if (
    received.size !== returned.length ||
    received.size !== expected.size ||
    [...expected].some((platform) => !received.has(platform))
  ) {
    throw new Error(`${stage} did not return exactly one result for every requested platform.`);
  }
}

function enforceReviewContract(draft: WriterDraft, review: PlatformReview): PlatformReview {
  const findings = review.findings.map((finding) => ({
    ...finding,
    quote: finding.quote && draft.content.includes(finding.quote) ? finding.quote : "",
  }));
  const limit = PLATFORM_LIMITS[draft.platform];
  const count = countDraftCharacters(draft.content);
  const overLimit = count > limit;

  if (overLimit) {
    const limitFinding = {
      category: "LENGTH" as const,
      quote: "",
      message: `${draft.platform === "LINKEDIN" ? "LinkedIn" : "Threads"} allows ${limit.toLocaleString()} characters; this draft has ${count.toLocaleString()}.`,
      required_change: `Remove at least ${(count - limit).toLocaleString()} characters without weakening the core claim.`,
    };
    const existingIndex = findings.findIndex((finding) => finding.category === "LENGTH");
    if (existingIndex >= 0) findings[existingIndex] = limitFinding;
    else if (findings.length < 8) findings.push(limitFinding);
    else findings[findings.length - 1] = limitFinding;
  }

  return {
    ...review,
    verdict: review.verdict === "NEEDS_INPUT"
      ? "NEEDS_INPUT"
      : overLimit
        ? "REVISE"
        : review.verdict,
    findings,
  };
}

function reviewState(review: PlatformReview): DraftReviewState {
  return review.verdict;
}

function configuredModels(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(getDraftAgentConfig()).map(([agent, config]) => [agent, config.model]),
  );
}

export async function runDrafting(
  source: DraftSourceContext,
  rawRequest: DraftRequest,
  createdBy: string | null,
  dependencies: DraftingDependencies,
): Promise<DraftSession> {
  const request = DraftRequestSchema.parse(rawRequest);
  const { gateway, repository, onEvent = () => undefined } = dependencies;
  const config = getDraftAgentConfig();
  const sessionId = randomUUID();
  const actualModels = configuredModels();
  let totalUsage = emptyUsage();
  let sessionCreated = false;

  async function executeStage<T>(requestDetails: DraftStageRequest<T>): Promise<CompletionResult<T>> {
    await onEvent({
      type: "draft_stage_started",
      session_id: sessionId,
      stage: requestDetails.eventStage,
    });
    const agentRunId = await repository.startAgentRun(
      sessionId,
      requestDetails.agent,
      requestDetails.config.model,
      requestDetails.persistenceInput,
    );
    const startedAt = performance.now();
    try {
      const result = await gateway.complete({
        system: requestDetails.system,
        user: requestDetails.user,
        schemaName: requestDetails.schemaName,
        schema: requestDetails.schema,
        config: requestDetails.config,
      });
      await repository.completeAgentRun(agentRunId, {
        output: result.data,
        model: result.model,
        provider: result.provider,
        generationId: result.generationId,
        usage: result.usage,
        durationMs: Math.round(performance.now() - startedAt),
      });
      actualModels[requestDetails.agent] = result.model;
      totalUsage = combineUsage(totalUsage, result.usage);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown model error";
      await repository.failAgentRun(
        agentRunId,
        message,
        Math.round(performance.now() - startedAt),
      );
      throw error;
    }
  }

  try {
    await repository.createSession(sessionId, source, request, actualModels, createdBy);
    sessionCreated = true;
    await onEvent({
      type: "draft_session_started",
      session_id: sessionId,
      models: actualModels,
      platforms: request.platforms,
    });

    const writerResult = await executeStage({
      sessionId,
      agent: "drafter",
      eventStage: "drafter",
      config: config.drafter,
      system: drafterSystemPrompt,
      user: drafterUserPrompt(source, request),
      schemaName: "social_drafts",
      schema: WriterOutputSchema,
      persistenceInput: { source, request },
    });
    assertExactPlatforms("Drafter", request.platforms, writerResult.data.drafts);
    for (const draft of writerResult.data.drafts) {
      await repository.saveRevision(
        sessionId, draft.platform, 1, "WRITER", draft.content, "UNCHECKED", null, createdBy,
      );
    }
    await onEvent({
      type: "draft_stage_completed",
      session_id: sessionId,
      stage: "drafter",
      summary: `${writerResult.data.drafts.length} platform-native ${writerResult.data.drafts.length === 1 ? "draft" : "drafts"} written`,
    });

    const reviewerResult = await executeStage({
      sessionId,
      agent: "reviewer",
      eventStage: "reviewer",
      config: config.reviewer,
      system: draftReviewerSystemPrompt,
      user: draftReviewerUserPrompt(source, request.evidence, writerResult.data.drafts),
      schemaName: "social_draft_reviews",
      schema: DraftReviewerOutputSchema,
      persistenceInput: { source, evidence: request.evidence, drafts: writerResult.data.drafts },
    });
    assertExactPlatforms("Reviewer", request.platforms, reviewerResult.data.reviews);
    const firstReviews = reviewerResult.data.reviews.map((review) => {
      const draft = writerResult.data.drafts.find((item) => item.platform === review.platform);
      if (!draft) throw new Error(`Reviewer returned an unexpected ${review.platform} result.`);
      return enforceReviewContract(draft, review);
    });
    for (const review of firstReviews) {
      await repository.applyReview(sessionId, review.platform, 1, reviewState(review), review);
    }
    await onEvent({
      type: "draft_stage_completed",
      session_id: sessionId,
      stage: "reviewer",
      summary: `${firstReviews.filter((review) => review.verdict === "PASS").length} passed · ${firstReviews.filter((review) => review.verdict === "REVISE").length} marked for repair`,
    });

    const repairReviews = firstReviews.filter((review) => review.verdict === "REVISE");
    if (repairReviews.length > 0) {
      const repairPlatforms = repairReviews.map((review) => review.platform);
      const repairDrafts = writerResult.data.drafts.filter((draft) =>
        repairPlatforms.includes(draft.platform)
      );
      const repairResult = await executeStage({
        sessionId,
        agent: "drafter",
        eventStage: "repair",
        config: config.drafter,
        system: repairSystemPrompt,
        user: repairUserPrompt(source, request, repairDrafts, repairReviews),
        schemaName: "social_draft_repairs",
        schema: WriterOutputSchema,
        persistenceInput: { source, request, drafts: repairDrafts, reviews: repairReviews },
      });
      assertExactPlatforms("Repair", repairPlatforms, repairResult.data.drafts);
      for (const draft of repairResult.data.drafts) {
        const priorReview = repairReviews.find((review) => review.platform === draft.platform);
        if (!priorReview) throw new Error(`Repair returned an unexpected ${draft.platform} draft.`);
        const count = countDraftCharacters(draft.content);
        const withinLimit = count <= PLATFORM_LIMITS[draft.platform];
        const repairReview: PlatformReview = {
          ...priorReview,
          verdict: "REVISE",
          summary: withinLimit
            ? "One automated repair pass was applied. A human should inspect the revision or run Check again."
            : `The automated repair is still over the ${PLATFORM_LIMITS[draft.platform].toLocaleString()} character limit.`,
          findings: enforceReviewContract(draft, priorReview).findings,
        };
        await repository.saveRevision(
          sessionId,
          draft.platform,
          2,
          "REPAIR",
          draft.content,
          withinLimit ? "REPAIRED" : "REVISE",
          repairReview,
          createdBy,
        );
      }
      await onEvent({
        type: "draft_stage_completed",
        session_id: sessionId,
        stage: "repair",
        summary: `${repairResult.data.drafts.length} bounded ${repairResult.data.drafts.length === 1 ? "repair" : "repairs"} applied`,
      });
    }

    const status = firstReviews.some((review) => review.verdict === "NEEDS_INPUT")
      ? "NEEDS_INPUT"
      : "READY_FOR_REVIEW";
    await repository.finishSession(sessionId, status, totalUsage, actualModels);
    const session = await repository.getSession(sessionId);
    if (!session) throw new Error("The completed drafting session could not be loaded.");
    await onEvent({ type: "draft_session_completed", session_id: sessionId, session });
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drafting failed unexpectedly.";
    if (sessionCreated) {
      try {
        await repository.failSession(sessionId, message);
      } catch {
        // Preserve the model or validation error if persistence also fails.
      }
    }
    await onEvent({ type: "draft_session_failed", session_id: sessionId, error: message });
    throw error;
  }
}

export async function repairDraftRevision(
  sessionId: string,
  rawRequest: DraftRepairRequest,
  createdBy: string | null,
  dependencies: DraftingDependencies,
): Promise<DraftSession> {
  const request = DraftRepairRequestSchema.parse(rawRequest);
  const { gateway, repository, onEvent = () => undefined } = dependencies;
  const session = await repository.getSession(sessionId);
  const source = await repository.getSessionContext(sessionId);
  if (!session || !source) throw new Error("Drafting session not found.");

  const platformView = session.drafts.find((draft) => draft.platform === request.platform);
  const sourceRevision = platformView?.revisions.find(
    (revision) => revision.revision === request.revision,
  );
  if (!sourceRevision) {
    throw new Error(`Revision ${request.revision} was not found for ${request.platform}.`);
  }

  const config = getDraftAgentConfig().drafter;
  const agentRunId = await repository.startAgentRun(
    sessionId,
    "drafter",
    config.model,
    { source, evidence: session.evidence, guidance: session.guidance, sourceRevision, request },
  );
  await onEvent({ type: "draft_stage_started", session_id: sessionId, stage: "repair" });
  const startedAt = performance.now();
  let agentCompleted = false;
  try {
    const result = await gateway.complete({
      system: operatorRepairSystemPrompt,
      user: operatorRepairUserPrompt(
        source,
        session.evidence,
        session.guidance,
        sourceRevision,
        request,
      ),
      schemaName: "social_draft_operator_repair",
      schema: WriterOutputSchema,
      config,
    });
    assertExactPlatforms("Repair", [request.platform], result.data.drafts);
    await repository.completeAgentRun(agentRunId, {
      output: result.data,
      model: result.model,
      provider: result.provider,
      generationId: result.generationId,
      usage: result.usage,
      durationMs: Math.round(performance.now() - startedAt),
    });
    agentCompleted = true;

    const repairedDraft = result.data.drafts[0];
    const saved = await repository.saveRepairRevision(
      sessionId,
      request.platform,
      repairedDraft.content,
      createdBy,
    );
    if (!saved) throw new Error("Drafting session not found.");

    const status = saved.drafts.some((draft) => draft.current.review_state === "NEEDS_INPUT")
      ? "NEEDS_INPUT"
      : "READY_FOR_REVIEW";
    await repository.finishSession(
      sessionId,
      status,
      combineUsage(session.usage, result.usage),
      { ...session.models, drafter: result.model },
    );
    const completed = await repository.getSession(sessionId);
    if (!completed) throw new Error("The repaired drafting session could not be loaded.");
    await onEvent({
      type: "draft_stage_completed",
      session_id: sessionId,
      stage: "repair",
      summary: `${request.platform === "LINKEDIN" ? "LinkedIn" : "Threads"} revision ${sourceRevision.revision} repaired as a new revision`,
    });
    await onEvent({ type: "draft_session_completed", session_id: sessionId, session: completed });
    return completed;
  } catch (error) {
    if (!agentCompleted) {
      const message = error instanceof Error ? error.message : "Draft repair failed unexpectedly.";
      await repository.failAgentRun(
        agentRunId,
        message,
        Math.round(performance.now() - startedAt),
      );
    }
    throw error;
  }
}

export async function reviewDraftSession(
  sessionId: string,
  selectedPlatforms: DraftPlatform[] | undefined,
  dependencies: DraftingDependencies,
): Promise<DraftSession> {
  const { gateway, repository, onEvent = () => undefined } = dependencies;
  const session = await repository.getSession(sessionId);
  const source = await repository.getSessionContext(sessionId);
  if (!session || !source) throw new Error("Drafting session not found.");

  const platforms = selectedPlatforms ?? session.requested_platforms;
  if (
    platforms.length < 1 ||
    new Set(platforms).size !== platforms.length ||
    platforms.some((platform) => !session.requested_platforms.includes(platform))
  ) {
    throw new Error("Choose one or more platforms from this drafting session.");
  }
  const drafts: WriterDraft[] = platforms.map((platform) => {
    const current = session.drafts.find((item) => item.platform === platform)?.current;
    if (!current) throw new Error(`No ${platform} draft exists in this session.`);
    return { platform, content: current.content };
  });

  const config = getDraftAgentConfig().reviewer;
  const agentRunId = await repository.startAgentRun(
    sessionId,
    "reviewer",
    config.model,
    { source, evidence: session.evidence, drafts },
  );
  await onEvent({ type: "draft_stage_started", session_id: sessionId, stage: "reviewer" });
  const startedAt = performance.now();
  let agentCompleted = false;
  try {
    const result = await gateway.complete({
      system: draftReviewerSystemPrompt,
      user: draftReviewerUserPrompt(source, session.evidence, drafts),
      schemaName: "social_draft_reviews",
      schema: DraftReviewerOutputSchema,
      config,
    });
    assertExactPlatforms("Reviewer", platforms, result.data.reviews);
    await repository.completeAgentRun(agentRunId, {
      output: result.data,
      model: result.model,
      provider: result.provider,
      generationId: result.generationId,
      usage: result.usage,
      durationMs: Math.round(performance.now() - startedAt),
    });
    agentCompleted = true;

    const reviews: DraftReviewerOutput["reviews"] = result.data.reviews.map((review) => {
      const draft = drafts.find((item) => item.platform === review.platform);
      if (!draft) throw new Error(`Reviewer returned an unexpected ${review.platform} result.`);
      return enforceReviewContract(draft, review);
    });
    for (const review of reviews) {
      const current = session.drafts.find((item) => item.platform === review.platform)?.current;
      if (!current) continue;
      await repository.applyReview(
        sessionId, review.platform, current.revision, reviewState(review), review,
      );
    }

    const refreshed = await repository.getSession(sessionId);
    if (!refreshed) throw new Error("The reviewed drafting session could not be loaded.");
    const status = refreshed.drafts.some((draft) => draft.current.review_state === "NEEDS_INPUT")
      ? "NEEDS_INPUT"
      : "READY_FOR_REVIEW";
    const usage = combineUsage(session.usage, result.usage);
    const models = { ...session.models, reviewer: result.model };
    await repository.finishSession(sessionId, status, usage, models);
    const completed = await repository.getSession(sessionId);
    if (!completed) throw new Error("The reviewed drafting session could not be loaded.");
    await onEvent({
      type: "draft_stage_completed",
      session_id: sessionId,
      stage: "reviewer",
      summary: `${reviews.filter((review) => review.verdict === "PASS").length} passed review`,
    });
    await onEvent({ type: "draft_session_completed", session_id: sessionId, session: completed });
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Draft review failed unexpectedly.";
    if (!agentCompleted) {
      await repository.failAgentRun(agentRunId, message, Math.round(performance.now() - startedAt));
    }
    await onEvent({ type: "draft_session_failed", session_id: sessionId, error: message });
    throw error;
  }
}

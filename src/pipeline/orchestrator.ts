import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { contextFor } from "@/config/axelyn-context";
import { getAgentConfig, type AgentConfig, type AgentName } from "@/config/agents";
import {
  ExplorerOutputSchema,
  PipelineResultSchema,
  ScoutOutputSchema,
  SignalInputSchema,
  type Candidate,
  type CriticEvaluation,
  type FinalBrief,
  type PipelineResult,
  type SignalInput,
  type Usage,
} from "@/domain/schemas";
import { calculateStrategistScore } from "@/domain/scoring";
import type { CompletionResult, LlmGateway } from "@/llm/gateway";
import type { PipelineRepository } from "@/persistence/types";
import { criticSystemPrompt, criticUserPrompt } from "@/prompts/critic";
import { explorerSystemPrompt, explorerUserPrompt } from "@/prompts/explorer";
import { scoutSystemPrompt, scoutUserPrompt } from "@/prompts/scout";
import { strategistSystemPrompt, strategistUserPrompt } from "@/prompts/strategist";
import type { PipelineEventHandler } from "./events";
import {
  candidateReference,
  criticEvaluationRequestSchema,
  restoreCriticCandidateIds,
  restoreStrategistCandidateIds,
  strategistEvaluationRequestSchema,
} from "./evaluation-contract";

export interface PipelineDependencies {
  gateway: LlmGateway;
  repository: PipelineRepository;
  onEvent?: PipelineEventHandler;
}

interface StageRequest<T> {
  runId: string;
  agent: AgentName;
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

function assertMatchingIds(
  stage: string,
  candidates: Candidate[],
  evaluations: Array<{ candidate_id: string }>,
): void {
  const expected = new Set(candidates.map((candidate) => candidate.id));
  const received = new Set(evaluations.map((evaluation) => evaluation.candidate_id));
  if (
    received.size !== evaluations.length ||
    expected.size !== received.size ||
    [...expected].some((id) => !received.has(id))
  ) {
    throw new Error(`${stage} did not return exactly one evaluation for every candidate.`);
  }
}

export async function runPipeline(
  rawInput: SignalInput,
  dependencies: PipelineDependencies,
): Promise<PipelineResult> {
  const input = SignalInputSchema.parse(rawInput);
  const { gateway, repository, onEvent = () => undefined } = dependencies;
  const config = getAgentConfig();
  const configuredModels = Object.fromEntries(
    Object.entries(config).map(([agent, value]) => [agent, value.model]),
  );
  const actualModels: Record<string, string> = { ...configuredModels };
  const runId = randomUUID();
  let totalUsage = emptyUsage();
  let runCreated = false;

  async function executeStage<T>(request: StageRequest<T>): Promise<CompletionResult<T>> {
    await onEvent({ type: "stage_started", run_id: runId, stage: request.agent });
    const agentRunId = await repository.startAgentRun(
      runId,
      request.agent,
      request.config.model,
      request.persistenceInput,
    );
    const startedAt = performance.now();
    try {
      const result = await gateway.complete({
        system: request.system,
        user: request.user,
        schemaName: request.schemaName,
        schema: request.schema,
        config: request.config,
      });
      await repository.completeAgentRun(agentRunId, {
        output: result.data,
        model: result.model,
        provider: result.provider,
        generationId: result.generationId,
        usage: result.usage,
        durationMs: Math.round(performance.now() - startedAt),
      });
      actualModels[request.agent] = result.model;
      totalUsage = combineUsage(totalUsage, result.usage);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown model error";
      await repository.failAgentRun(agentRunId, message, Math.round(performance.now() - startedAt));
      throw error;
    }
  }

  try {
    await repository.createRun(runId, input, configuredModels);
    runCreated = true;
    await onEvent({ type: "run_started", run_id: runId, models: configuredModels });

    const scoutResult = await executeStage({
      runId,
      agent: "scout",
      config: config.scout,
      system: scoutSystemPrompt,
      user: scoutUserPrompt(input, contextFor("scout")),
      schemaName: "scout_output",
      schema: ScoutOutputSchema,
      persistenceInput: input,
    });
    const scout = scoutResult.data;
    await repository.saveScout(runId, scout);
    await onEvent({
      type: "stage_completed",
      run_id: runId,
      stage: "scout",
      summary: scout.continue_pipeline ? "Signal qualified" : "Signal stopped",
    });

    if (!scout.continue_pipeline) {
      const result = PipelineResultSchema.parse({
        run_id: runId,
        status: "STOPPED",
        scout,
        briefs: [],
        usage: totalUsage,
        models: actualModels,
      });
      await repository.finishRun(runId, "STOPPED", totalUsage, actualModels);
      await onEvent({ type: "pipeline_completed", run_id: runId, result });
      return result;
    }

    const explorerResult = await executeStage({
      runId,
      agent: "explorer",
      config: config.explorer,
      system: explorerSystemPrompt,
      user: explorerUserPrompt(scout, contextFor("explorer")),
      schemaName: "explorer_output",
      schema: ExplorerOutputSchema,
      persistenceInput: scout,
    });
    const selectedTaxonomies = new Set(explorerResult.data.selected_taxonomies);
    if (explorerResult.data.candidates.some((candidate) => !selectedTaxonomies.has(candidate.taxonomy))) {
      throw new Error("Explorer returned a candidate outside its selected taxonomies.");
    }
    const candidates: Candidate[] = explorerResult.data.candidates.map((candidate) => ({
      ...candidate,
      id: randomUUID(),
    }));
    await repository.saveCandidates(runId, candidates);
    await onEvent({
      type: "stage_completed",
      run_id: runId,
      stage: "explorer",
      summary: `${candidates.length} angles across ${selectedTaxonomies.size} primary jobs`,
    });

    const referencedCandidates = candidates.map((candidate, index) => ({
      candidate_ref: candidateReference(index),
      candidate,
    }));
    const criticResult = await executeStage({
      runId,
      agent: "critic",
      config: config.critic,
      system: criticSystemPrompt,
      user: criticUserPrompt(scout, referencedCandidates, contextFor("critic")),
      schemaName: "critic_output",
      schema: criticEvaluationRequestSchema(candidates),
      persistenceInput: { scout, candidates },
    });
    const criticOutput = restoreCriticCandidateIds(candidates, criticResult.data.evaluations);
    assertMatchingIds("Critic", candidates, criticOutput.evaluations);
    await repository.saveCritiques(runId, criticOutput.evaluations);
    const critiquesById = new Map(
      criticOutput.evaluations.map((evaluation) => [evaluation.candidate_id, evaluation]),
    );
    const survivors = candidates.filter(
      (candidate) => critiquesById.get(candidate.id)?.recommendation !== "KILL",
    );
    await onEvent({
      type: "stage_completed",
      run_id: runId,
      stage: "critic",
      summary: `${survivors.length} survived · ${candidates.length - survivors.length} killed`,
    });

    let briefs: FinalBrief[] = [];
    if (survivors.length > 0) {
      const strategyCandidates = survivors.map((candidate, index) => ({
        candidate_ref: candidateReference(index),
        candidate,
        critique: critiquesById.get(candidate.id) as CriticEvaluation,
      }));
      const strategistResult = await executeStage({
        runId,
        agent: "strategist",
        config: config.strategist,
        system: strategistSystemPrompt,
        user: strategistUserPrompt(scout, strategyCandidates, contextFor("strategist")),
        schemaName: "strategist_output",
        schema: strategistEvaluationRequestSchema(survivors),
        persistenceInput: { scout, candidates: strategyCandidates },
      });
      const strategistOutput = restoreStrategistCandidateIds(
        survivors,
        strategistResult.data.evaluations,
      );
      assertMatchingIds("Strategist", survivors, strategistOutput.evaluations);

      const candidatesById = new Map(survivors.map((candidate) => [candidate.id, candidate]));
      for (const evaluation of strategistOutput.evaluations) {
        if (evaluation.primary_job !== candidatesById.get(evaluation.candidate_id)?.taxonomy) {
          throw new Error("Strategist changed a candidate's primary job.");
        }
      }

      const scores = new Map(
        strategistOutput.evaluations.map((evaluation) => [
          evaluation.candidate_id,
          calculateStrategistScore(evaluation),
        ]),
      );
      await repository.saveStrategies(runId, strategistOutput.evaluations, scores);

      briefs = strategistOutput.evaluations
        .filter((evaluation) => evaluation.readiness_status !== "KILLED")
        .map((evaluation) => {
          return {
            candidate_id: evaluation.candidate_id,
            title: evaluation.title,
            primary_job: evaluation.primary_job,
            target_audience: evaluation.target_audience,
            core_claim: evaluation.core_claim,
            why_people_care: evaluation.why_people_care,
            axelyn_right_to_speak: evaluation.axelyn_right_to_speak,
            reader_takeaway: evaluation.reader_takeaway,
            counterargument: evaluation.counterargument,
            evidence_needed: evaluation.evidence_needed,
            linkedin_angle: evaluation.linkedin_angle,
            threads_angle: evaluation.threads_angle,
            recommended_platform: evaluation.recommended_platform,
            strategic_reasoning: evaluation.strategic_reasoning,
            rank: 0,
            score: scores.get(evaluation.candidate_id) ?? 0,
            status: evaluation.readiness_status,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((brief, index) => ({ ...brief, rank: index + 1 }));
      await repository.saveBriefs(runId, briefs);
      await onEvent({
        type: "stage_completed",
        run_id: runId,
        stage: "strategist",
        summary: `${briefs.length} editorial briefs ranked`,
      });
    } else {
      await onEvent({
        type: "stage_completed",
        run_id: runId,
        stage: "strategist",
        summary: "Skipped · no candidates survived",
      });
    }

    const result = PipelineResultSchema.parse({
      run_id: runId,
      status: "COMPLETED",
      scout,
      briefs,
      usage: totalUsage,
      models: actualModels,
    });
    await repository.finishRun(runId, "COMPLETED", totalUsage, actualModels);
    await onEvent({ type: "pipeline_completed", run_id: runId, result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The pipeline failed unexpectedly.";
    if (runCreated) {
      try {
        await repository.failRun(runId, message);
      } catch {
        // Preserve the original pipeline error even if persistence is also unavailable.
      }
    }
    await onEvent({ type: "pipeline_failed", run_id: runId, error: message });
    throw error;
  }
}

import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";
import type {
  AgentRunCompletion,
  PipelineRepository,
  RecentRun,
  RunStatus,
  StoredRun,
} from "./types";
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

function now(): string {
  return new Date().toISOString();
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class SqlitePipelineRepository implements PipelineRepository {
  private readonly db = getDatabase();

  createRun(id: string, input: SignalInput, models: Record<string, string>): void {
    this.db.prepare(`
      INSERT INTO pipeline_runs (id, source_type, content, context, status, models_json, created_at)
      VALUES (?, ?, ?, ?, 'RUNNING', ?, ?)
    `).run(id, input.source_type, input.content, input.context, json(models), now());
  }

  startAgentRun(runId: string, agent: AgentName, model: string, input: unknown): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO agent_runs (id, pipeline_run_id, agent, model, status, input_json, started_at)
      VALUES (?, ?, ?, ?, 'RUNNING', ?, ?)
    `).run(id, runId, agent, model, json(input), now());
    return id;
  }

  completeAgentRun(agentRunId: string, completion: AgentRunCompletion): void {
    this.db.prepare(`
      UPDATE agent_runs SET
        status = 'COMPLETED', output_json = ?, model = ?, provider = ?, generation_id = ?,
        prompt_tokens = ?, completion_tokens = ?, reasoning_tokens = ?, cached_tokens = ?,
        actual_cost = ?, estimated_cost = ?, duration_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(
      json(completion.output), completion.model, completion.provider, completion.generationId,
      completion.usage.prompt_tokens, completion.usage.completion_tokens,
      completion.usage.reasoning_tokens, completion.usage.cached_tokens,
      completion.usage.cost, completion.usage.estimated_cost, completion.durationMs,
      now(), agentRunId,
    );
  }

  failAgentRun(agentRunId: string, error: string, durationMs: number): void {
    this.db.prepare(`
      UPDATE agent_runs SET status = 'FAILED', error = ?, duration_ms = ?, completed_at = ? WHERE id = ?
    `).run(error, durationMs, now(), agentRunId);
  }

  saveScout(runId: string, output: ScoutOutput): void {
    this.db.prepare("UPDATE pipeline_runs SET scout_output = ? WHERE id = ?").run(json(output), runId);
  }

  saveCandidates(runId: string, candidates: Candidate[]): void {
    const statement = this.db.prepare(`
      INSERT INTO candidates (id, pipeline_run_id, taxonomy, data_json, created_at) VALUES (?, ?, ?, ?, ?)
    `);
    const timestamp = now();
    for (const candidate of candidates) {
      statement.run(candidate.id, runId, candidate.taxonomy, json(candidate), timestamp);
    }
  }

  saveCritiques(runId: string, critiques: CriticEvaluation[]): void {
    const statement = this.db.prepare(`
      INSERT INTO critic_evaluations (id, pipeline_run_id, candidate_id, recommendation, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const timestamp = now();
    for (const critique of critiques) {
      statement.run(randomUUID(), runId, critique.candidate_id, critique.recommendation, json(critique), timestamp);
    }
  }

  saveStrategies(runId: string, strategies: StrategistEvaluation[], scores: Map<string, number>): void {
    const statement = this.db.prepare(`
      INSERT INTO strategist_evaluations
        (id, pipeline_run_id, candidate_id, final_score, readiness_status, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const timestamp = now();
    for (const strategy of strategies) {
      statement.run(
        randomUUID(), runId, strategy.candidate_id, scores.get(strategy.candidate_id) ?? 0,
        strategy.readiness_status, json(strategy), timestamp,
      );
    }
  }

  saveBriefs(runId: string, briefs: FinalBrief[]): void {
    const statement = this.db.prepare(`
      INSERT INTO editorial_briefs
        (id, pipeline_run_id, candidate_id, rank, score, status, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const timestamp = now();
    for (const brief of briefs) {
      statement.run(
        randomUUID(), runId, brief.candidate_id, brief.rank, brief.score,
        brief.status, json(brief), timestamp,
      );
    }
  }

  finishRun(
    runId: string,
    status: "COMPLETED" | "STOPPED",
    usage: Usage,
    models: Record<string, string>,
  ): void {
    this.db.prepare(`
      UPDATE pipeline_runs SET status = ?, models_json = ?, total_tokens = ?, actual_cost = ?,
        estimated_cost = ?, completed_at = ? WHERE id = ?
    `).run(status, json(models), usage.total_tokens, usage.cost, usage.estimated_cost, now(), runId);
  }

  failRun(runId: string, error: string): void {
    this.db.prepare(`
      UPDATE pipeline_runs SET status = 'FAILED', error = ?, completed_at = ? WHERE id = ?
    `).run(error, now(), runId);
  }

  listRuns(limit = 12): RecentRun[] {
    const rows = this.db.prepare(`
      SELECT r.id, r.source_type, r.content, r.status, r.total_tokens, r.estimated_cost, r.created_at,
        COUNT(b.id) AS brief_count
      FROM pipeline_runs r
      LEFT JOIN editorial_briefs b ON b.pipeline_run_id = r.id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(limit, 50))) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      source_type: row.source_type as SignalInput["source_type"],
      content: String(row.content),
      status: row.status as RunStatus,
      brief_count: Number(row.brief_count),
      total_tokens: Number(row.total_tokens),
      estimated_cost: Number(row.estimated_cost),
      created_at: String(row.created_at),
    }));
  }

  getRun(id: string): StoredRun | null {
    const row = this.db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM editorial_briefs b WHERE b.pipeline_run_id = r.id) AS brief_count
      FROM pipeline_runs r WHERE r.id = ?
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    const briefRows = this.db.prepare(`
      SELECT data_json FROM editorial_briefs WHERE pipeline_run_id = ? ORDER BY rank ASC
    `).all(id) as Array<{ data_json: string }>;

    return {
      id: String(row.id),
      source_type: row.source_type as SignalInput["source_type"],
      content: String(row.content),
      context: String(row.context),
      status: row.status as RunStatus,
      brief_count: Number(row.brief_count),
      total_tokens: Number(row.total_tokens),
      estimated_cost: Number(row.estimated_cost),
      actual_cost: row.actual_cost === null ? null : Number(row.actual_cost),
      created_at: String(row.created_at),
      completed_at: row.completed_at ? String(row.completed_at) : null,
      error: row.error ? String(row.error) : null,
      scout: parse<ScoutOutput | null>(row.scout_output, null),
      briefs: briefRows.map((brief) => parse<FinalBrief>(brief.data_json, {} as FinalBrief)),
      models: parse<Record<string, string>>(row.models_json, {}),
    };
  }
}

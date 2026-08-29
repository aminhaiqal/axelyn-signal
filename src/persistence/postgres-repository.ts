import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ensureDatabase, getPool } from "./postgres";
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

async function transaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await work(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export class PostgresPipelineRepository implements PipelineRepository {
  async createRun(id: string, input: SignalInput, models: Record<string, string>): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      INSERT INTO pipeline_runs (id, source_type, content, context, status, models_json)
      VALUES ($1, $2, $3, $4, 'RUNNING', $5::jsonb)
    `, [id, input.source_type, input.content, input.context, JSON.stringify(models)]);
  }

  async startAgentRun(
    runId: string,
    agent: AgentName,
    model: string,
    input: unknown,
  ): Promise<string> {
    await ensureDatabase();
    const id = randomUUID();
    await getPool().query(`
      INSERT INTO agent_runs (id, pipeline_run_id, agent, model, status, input_json)
      VALUES ($1, $2, $3, $4, 'RUNNING', $5::jsonb)
    `, [id, runId, agent, model, JSON.stringify(input)]);
    return id;
  }

  async completeAgentRun(agentRunId: string, completion: AgentRunCompletion): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE agent_runs SET
        status = 'COMPLETED', output_json = $1::jsonb, model = $2, provider = $3, generation_id = $4,
        prompt_tokens = $5, completion_tokens = $6, reasoning_tokens = $7, cached_tokens = $8,
        actual_cost = $9, estimated_cost = $10, duration_ms = $11, completed_at = NOW()
      WHERE id = $12
    `, [
      JSON.stringify(completion.output), completion.model, completion.provider, completion.generationId,
      completion.usage.prompt_tokens, completion.usage.completion_tokens,
      completion.usage.reasoning_tokens, completion.usage.cached_tokens,
      completion.usage.cost, completion.usage.estimated_cost, completion.durationMs, agentRunId,
    ]);
  }

  async failAgentRun(agentRunId: string, error: string, durationMs: number): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE agent_runs SET status = 'FAILED', error = $1, duration_ms = $2, completed_at = NOW()
      WHERE id = $3
    `, [error, durationMs, agentRunId]);
  }

  async saveScout(runId: string, output: ScoutOutput): Promise<void> {
    await ensureDatabase();
    await getPool().query(
      "UPDATE pipeline_runs SET scout_output = $1::jsonb WHERE id = $2",
      [JSON.stringify(output), runId],
    );
  }

  async saveCandidates(runId: string, candidates: Candidate[]): Promise<void> {
    await transaction(async (client) => {
      for (const candidate of candidates) {
        await client.query(`
          INSERT INTO candidates (id, pipeline_run_id, taxonomy, data_json)
          VALUES ($1, $2, $3, $4::jsonb)
        `, [candidate.id, runId, candidate.taxonomy, JSON.stringify(candidate)]);
      }
    });
  }

  async saveCritiques(runId: string, critiques: CriticEvaluation[]): Promise<void> {
    await transaction(async (client) => {
      for (const critique of critiques) {
        await client.query(`
          INSERT INTO critic_evaluations
            (id, pipeline_run_id, candidate_id, recommendation, data_json)
          VALUES ($1, $2, $3, $4, $5::jsonb)
        `, [randomUUID(), runId, critique.candidate_id, critique.recommendation, JSON.stringify(critique)]);
      }
    });
  }

  async saveStrategies(
    runId: string,
    strategies: StrategistEvaluation[],
    scores: Map<string, number>,
  ): Promise<void> {
    await transaction(async (client) => {
      for (const strategy of strategies) {
        await client.query(`
          INSERT INTO strategist_evaluations
            (id, pipeline_run_id, candidate_id, final_score, readiness_status, data_json)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `, [
          randomUUID(), runId, strategy.candidate_id, scores.get(strategy.candidate_id) ?? 0,
          strategy.readiness_status, JSON.stringify(strategy),
        ]);
      }
    });
  }

  async saveBriefs(runId: string, briefs: FinalBrief[]): Promise<void> {
    await transaction(async (client) => {
      for (const brief of briefs) {
        await client.query(`
          INSERT INTO editorial_briefs
            (id, pipeline_run_id, candidate_id, rank, score, status, data_json)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        `, [
          randomUUID(), runId, brief.candidate_id, brief.rank, brief.score,
          brief.status, JSON.stringify(brief),
        ]);
      }
    });
  }

  async finishRun(
    runId: string,
    status: "COMPLETED" | "STOPPED",
    usage: Usage,
    models: Record<string, string>,
  ): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE pipeline_runs SET status = $1, models_json = $2::jsonb, total_tokens = $3,
        actual_cost = $4, estimated_cost = $5, completed_at = NOW() WHERE id = $6
    `, [status, JSON.stringify(models), usage.total_tokens, usage.cost, usage.estimated_cost, runId]);
  }

  async failRun(runId: string, error: string): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE pipeline_runs SET status = 'FAILED', error = $1, completed_at = NOW() WHERE id = $2
    `, [error, runId]);
  }

  async listRuns(limit = 12): Promise<RecentRun[]> {
    await ensureDatabase();
    const result = await getPool().query(`
      SELECT r.id, r.source_type, r.content, r.status, r.total_tokens, r.estimated_cost, r.created_at,
        COUNT(b.id) AS brief_count
      FROM pipeline_runs r
      LEFT JOIN editorial_briefs b ON b.pipeline_run_id = r.id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT $1
    `, [Math.max(1, Math.min(limit, 50))]);

    return result.rows.map((row) => ({
      id: String(row.id),
      source_type: row.source_type as SignalInput["source_type"],
      content: String(row.content),
      status: row.status as RunStatus,
      brief_count: Number(row.brief_count),
      total_tokens: Number(row.total_tokens),
      estimated_cost: Number(row.estimated_cost),
      created_at: iso(row.created_at),
    }));
  }

  async getRun(id: string): Promise<StoredRun | null> {
    await ensureDatabase();
    const result = await getPool().query(`
      SELECT r.*,
        (SELECT COUNT(*) FROM editorial_briefs b WHERE b.pipeline_run_id = r.id) AS brief_count
      FROM pipeline_runs r WHERE r.id = $1
    `, [id]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    const briefResult = await getPool().query(`
      SELECT data_json FROM editorial_briefs WHERE pipeline_run_id = $1 ORDER BY rank ASC
    `, [id]);

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
      created_at: iso(row.created_at),
      completed_at: row.completed_at ? iso(row.completed_at) : null,
      error: row.error ? String(row.error) : null,
      scout: (row.scout_output as ScoutOutput | null) ?? null,
      briefs: briefResult.rows.map((brief) => brief.data_json as FinalBrief),
      models: (row.models_json as Record<string, string>) ?? {},
    };
  }

  async deleteRun(id: string): Promise<boolean> {
    await ensureDatabase();
    const result = await getPool().query(
      "DELETE FROM pipeline_runs WHERE id = $1 RETURNING id",
      [id],
    );
    return result.rowCount === 1;
  }
}

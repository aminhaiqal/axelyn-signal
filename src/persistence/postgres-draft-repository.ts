import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { DraftAgentName } from "@/config/agents";
import {
  DraftPlatformSchema,
  PLATFORM_LIMITS,
  countDraftCharacters,
  type DraftPlatform,
  type DraftRequest,
  type DraftReviewState,
  type DraftRevision,
  type DraftSession,
  type DraftSessionStatus,
  type DraftSource,
  type DraftSourceContext,
  type PlatformReview,
} from "@/domain/drafts";
import { FinalBriefSchema, type SignalInput, type Usage } from "@/domain/schemas";
import { ensureDatabase, getPool } from "./postgres";
import type { DraftRepository } from "./draft-types";
import type { AgentRunCompletion } from "./types";
import { mapBufferDelivery } from "./postgres-buffer-repository";

type DatabaseClient = Pool | PoolClient;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function nullableIso(value: unknown): string | null {
  return value ? iso(value) : null;
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapRevision(
  row: Record<string, unknown>,
  deliveries: ReturnType<typeof mapBufferDelivery>[] = [],
): DraftRevision {
  return {
    id: String(row.id),
    session_id: String(row.drafting_session_id),
    platform: DraftPlatformSchema.parse(row.platform),
    revision: Number(row.revision),
    source: row.source as DraftSource,
    content: String(row.content),
    character_count: Number(row.character_count),
    review_state: row.review_state as DraftReviewState,
    review: (row.review_json as PlatformReview | null) ?? null,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: iso(row.created_at),
    approved_by: row.approved_by ? String(row.approved_by) : null,
    approved_at: nullableIso(row.approved_at),
    buffer_deliveries: deliveries,
  };
}

async function readSession(id: string, client: DatabaseClient): Promise<DraftSession | null> {
  const sessionResult = await client.query(
    "SELECT * FROM drafting_sessions WHERE id = $1",
    [id],
  );
  const row = sessionResult.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const revisionResult = await client.query(`
    SELECT * FROM social_draft_revisions
    WHERE drafting_session_id = $1
    ORDER BY platform ASC, revision ASC
  `, [id]);
  const deliveryResult = await client.query(`
    SELECT d.* FROM buffer_deliveries d
    JOIN social_draft_revisions r ON r.id = d.draft_revision_id
    WHERE r.drafting_session_id = $1
    ORDER BY d.created_at ASC
  `, [id]);
  const deliveriesByRevision = new Map<string, ReturnType<typeof mapBufferDelivery>[]>();
  for (const deliveryRow of deliveryResult.rows) {
    const delivery = mapBufferDelivery(deliveryRow as Record<string, unknown>);
    const current = deliveriesByRevision.get(delivery.draft_revision_id) ?? [];
    current.push(delivery);
    deliveriesByRevision.set(delivery.draft_revision_id, current);
  }
  const revisions = revisionResult.rows.map((revision) => {
    const row = revision as Record<string, unknown>;
    return mapRevision(row, deliveriesByRevision.get(String(row.id)) ?? []);
  });
  const requestedPlatforms = (row.requested_platforms as unknown[]).map((platform) =>
    DraftPlatformSchema.parse(platform)
  );

  return {
    id: String(row.id),
    pipeline_run_id: String(row.pipeline_run_id),
    candidate_id: String(row.candidate_id),
    requested_platforms: requestedPlatforms,
    evidence: String(row.evidence),
    guidance: String(row.guidance),
    status: row.status as DraftSessionStatus,
    models: (row.models_json as Record<string, string>) ?? {},
    usage: {
      prompt_tokens: Number(row.prompt_tokens),
      completion_tokens: Number(row.completion_tokens),
      reasoning_tokens: Number(row.reasoning_tokens),
      cached_tokens: Number(row.cached_tokens),
      total_tokens: Number(row.total_tokens),
      cost: row.actual_cost === null ? null : Number(row.actual_cost),
      estimated_cost: Number(row.estimated_cost),
    },
    error: row.error ? String(row.error) : null,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: iso(row.created_at),
    completed_at: nullableIso(row.completed_at),
    drafts: requestedPlatforms.flatMap((platform) => {
      const platformRevisions = revisions.filter((revision) => revision.platform === platform);
      const current = platformRevisions.at(-1);
      return current ? [{ platform, current, revisions: platformRevisions }] : [];
    }),
  };
}

async function appendUncheckedRevision(
  sessionId: string,
  platform: DraftPlatform,
  source: Extract<DraftSource, "OPERATOR" | "REPAIR">,
  content: string,
  createdBy: string | null,
): Promise<boolean> {
  return transaction(async (client) => {
    const sessionResult = await client.query(`
      SELECT requested_platforms FROM drafting_sessions WHERE id = $1 FOR UPDATE
    `, [sessionId]);
    const sessionRow = sessionResult.rows[0] as Record<string, unknown> | undefined;
    if (!sessionRow) return false;
    const requested = (sessionRow.requested_platforms as unknown[]).map((value) =>
      DraftPlatformSchema.parse(value)
    );
    if (!requested.includes(platform)) {
      throw new Error(`${platform} was not requested for this drafting session.`);
    }

    const revisionResult = await client.query(`
      SELECT COALESCE(MAX(revision), 0) + 1 AS next_revision
      FROM social_draft_revisions
      WHERE drafting_session_id = $1 AND platform = $2
    `, [sessionId, platform]);
    const nextRevision = Number(revisionResult.rows[0].next_revision);
    await client.query(`
      INSERT INTO social_draft_revisions (
        id, drafting_session_id, platform, revision, source, content,
        character_count, review_state, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'UNCHECKED', $8)
    `, [
      randomUUID(), sessionId, platform, nextRevision, source, content,
      countDraftCharacters(content), createdBy,
    ]);
    await client.query(`
      UPDATE drafting_sessions
      SET status = CASE WHEN EXISTS (
        SELECT 1 FROM (
          SELECT DISTINCT ON (platform) platform, review_state
          FROM social_draft_revisions
          WHERE drafting_session_id = $1
          ORDER BY platform, revision DESC
        ) latest
        WHERE latest.review_state = 'NEEDS_INPUT'
      ) THEN 'NEEDS_INPUT' ELSE 'READY_FOR_REVIEW' END,
      error = NULL, completed_at = NOW()
      WHERE id = $1
    `, [sessionId]);
    return true;
  });
}

export class PostgresDraftRepository implements DraftRepository {
  async getBriefContext(runId: string, candidateId: string): Promise<DraftSourceContext | null> {
    await ensureDatabase();
    const result = await getPool().query(`
      SELECT r.id AS run_id, r.source_type, r.content, r.context, b.data_json
      FROM pipeline_runs r
      JOIN editorial_briefs b ON b.pipeline_run_id = r.id
      WHERE r.id = $1 AND b.candidate_id = $2
    `, [runId, candidateId]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      run_id: String(row.run_id),
      candidate_id: candidateId,
      source_type: row.source_type as SignalInput["source_type"],
      signal: String(row.content),
      signal_context: String(row.context),
      brief: FinalBriefSchema.parse(row.data_json),
    };
  }

  async createSession(
    id: string,
    source: DraftSourceContext,
    request: DraftRequest,
    models: Record<string, string>,
    createdBy: string | null,
  ): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      INSERT INTO drafting_sessions (
        id, pipeline_run_id, candidate_id, requested_platforms, evidence, guidance,
        status, models_json, created_by
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'RUNNING', $7::jsonb, $8)
    `, [
      id,
      source.run_id,
      source.candidate_id,
      JSON.stringify(request.platforms),
      request.evidence,
      request.guidance,
      JSON.stringify(models),
      createdBy,
    ]);
  }

  async startAgentRun(
    sessionId: string,
    agent: DraftAgentName,
    model: string,
    input: unknown,
  ): Promise<string> {
    await ensureDatabase();
    const id = randomUUID();
    await getPool().query(`
      INSERT INTO draft_agent_runs (
        id, drafting_session_id, agent, model, status, input_json
      ) VALUES ($1, $2, $3, $4, 'RUNNING', $5::jsonb)
    `, [id, sessionId, agent, model, JSON.stringify(input)]);
    return id;
  }

  async completeAgentRun(agentRunId: string, completion: AgentRunCompletion): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE draft_agent_runs SET
        status = 'COMPLETED', output_json = $1::jsonb, model = $2, provider = $3,
        generation_id = $4, prompt_tokens = $5, completion_tokens = $6,
        reasoning_tokens = $7, cached_tokens = $8, actual_cost = $9,
        estimated_cost = $10, duration_ms = $11, completed_at = NOW()
      WHERE id = $12
    `, [
      JSON.stringify(completion.output),
      completion.model,
      completion.provider,
      completion.generationId,
      completion.usage.prompt_tokens,
      completion.usage.completion_tokens,
      completion.usage.reasoning_tokens,
      completion.usage.cached_tokens,
      completion.usage.cost,
      completion.usage.estimated_cost,
      completion.durationMs,
      agentRunId,
    ]);
  }

  async failAgentRun(agentRunId: string, error: string, durationMs: number): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE draft_agent_runs
      SET status = 'FAILED', error = $1, duration_ms = $2, completed_at = NOW()
      WHERE id = $3
    `, [error, durationMs, agentRunId]);
  }

  async saveRevision(
    sessionId: string,
    platform: DraftPlatform,
    revision: number,
    source: DraftSource,
    content: string,
    reviewState: DraftReviewState,
    review: PlatformReview | null,
    createdBy: string | null,
  ): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      INSERT INTO social_draft_revisions (
        id, drafting_session_id, platform, revision, source, content,
        character_count, review_state, review_json, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
    `, [
      randomUUID(),
      sessionId,
      platform,
      revision,
      source,
      content,
      countDraftCharacters(content),
      reviewState,
      review ? JSON.stringify(review) : null,
      createdBy,
    ]);
  }

  async applyReview(
    sessionId: string,
    platform: DraftPlatform,
    revision: number,
    reviewState: DraftReviewState,
    review: PlatformReview,
  ): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE social_draft_revisions
      SET review_state = $1, review_json = $2::jsonb
      WHERE drafting_session_id = $3 AND platform = $4 AND revision = $5
    `, [reviewState, JSON.stringify(review), sessionId, platform, revision]);
  }

  async finishSession(
    sessionId: string,
    status: Exclude<DraftSessionStatus, "RUNNING" | "FAILED">,
    usage: Usage,
    models: Record<string, string>,
  ): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE drafting_sessions SET
        status = $1, models_json = $2::jsonb, prompt_tokens = $3,
        completion_tokens = $4, reasoning_tokens = $5, cached_tokens = $6,
        total_tokens = $7, actual_cost = $8, estimated_cost = $9,
        error = NULL, completed_at = NOW()
      WHERE id = $10
    `, [
      status,
      JSON.stringify(models),
      usage.prompt_tokens,
      usage.completion_tokens,
      usage.reasoning_tokens,
      usage.cached_tokens,
      usage.total_tokens,
      usage.cost,
      usage.estimated_cost,
      sessionId,
    ]);
  }

  async failSession(sessionId: string, error: string): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE drafting_sessions
      SET status = 'FAILED', error = $1, completed_at = NOW()
      WHERE id = $2
    `, [error, sessionId]);
  }

  async updateSessionStatus(sessionId: string, status: DraftSessionStatus): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE drafting_sessions SET status = $1, error = NULL WHERE id = $2
    `, [status, sessionId]);
  }

  async getSession(id: string): Promise<DraftSession | null> {
    await ensureDatabase();
    return readSession(id, getPool());
  }

  async listSessions(runId: string, candidateId: string): Promise<DraftSession[]> {
    await ensureDatabase();
    const result = await getPool().query(`
      SELECT id FROM drafting_sessions
      WHERE pipeline_run_id = $1 AND candidate_id = $2
      ORDER BY created_at DESC
      LIMIT 20
    `, [runId, candidateId]);
    const sessions = await Promise.all(
      result.rows.map((row) => readSession(String(row.id), getPool())),
    );
    return sessions.filter((session): session is DraftSession => session !== null);
  }

  async getSessionContext(id: string): Promise<DraftSourceContext | null> {
    await ensureDatabase();
    const result = await getPool().query(`
      SELECT pipeline_run_id, candidate_id FROM drafting_sessions WHERE id = $1
    `, [id]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.getBriefContext(String(row.pipeline_run_id), String(row.candidate_id));
  }

  async saveOperatorRevision(
    sessionId: string,
    platform: DraftPlatform,
    content: string,
    createdBy: string | null,
  ): Promise<DraftSession | null> {
    const saved = await appendUncheckedRevision(
      sessionId, platform, "OPERATOR", content, createdBy,
    );
    return saved ? this.getSession(sessionId) : null;
  }

  async saveRepairRevision(
    sessionId: string,
    platform: DraftPlatform,
    content: string,
    createdBy: string | null,
  ): Promise<DraftSession | null> {
    const saved = await appendUncheckedRevision(
      sessionId, platform, "REPAIR", content, createdBy,
    );
    return saved ? this.getSession(sessionId) : null;
  }

  async approveCurrentRevision(
    sessionId: string,
    platform: DraftPlatform,
    approvedBy: string | null,
  ): Promise<DraftSession | null> {
    const approved = await transaction(async (client) => {
      const revisionResult = await client.query(`
        SELECT id, character_count
        FROM social_draft_revisions
        WHERE drafting_session_id = $1 AND platform = $2
        ORDER BY revision DESC
        LIMIT 1
        FOR UPDATE
      `, [sessionId, platform]);
      const revision = revisionResult.rows[0] as Record<string, unknown> | undefined;
      if (!revision) return false;
      if (Number(revision.character_count) > PLATFORM_LIMITS[platform]) {
        throw new Error(
          `${platform === "LINKEDIN" ? "LinkedIn" : "Threads"} drafts must be within ${PLATFORM_LIMITS[platform].toLocaleString()} characters before approval.`,
        );
      }
      await client.query(`
        UPDATE social_draft_revisions
        SET approved_by = $1, approved_at = NOW()
        WHERE id = $2
      `, [approvedBy, revision.id]);
      return true;
    });
    return approved ? this.getSession(sessionId) : null;
  }
}

import { Pool, type PoolClient } from "pg";

declare global {
  var __axelynSignalPgPool: Pool | undefined;
  var __axelynSignalDbReady: Promise<void> | undefined;
}

function poolSize(): number {
  const parsed = Number(process.env.PG_POOL_MAX ?? 5);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 30 ? parsed : 5;
}

export function getPool(): Pool {
  if (globalThis.__axelynSignalPgPool) return globalThis.__axelynSignalPgPool;

  const connectionString = process.env.DATABASE_URL;
  const host = process.env.PGHOST;
  if (!connectionString && !host) {
    throw new Error("PostgreSQL is not configured. Set DATABASE_URL or the PGHOST connection settings.");
  }

  const pool = new Pool({
    ...(connectionString
      ? { connectionString }
      : {
          host,
          port: Number(process.env.PGPORT ?? 5432),
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD,
          database: process.env.PGDATABASE,
        }),
    max: poolSize(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });
  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error", error);
  });

  globalThis.__axelynSignalPgPool = pool;
  return pool;
}

async function migrate(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(814502326)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id UUID PRIMARY KEY,
        source_type TEXT NOT NULL,
        content TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        scout_output JSONB,
        models_json JSONB NOT NULL,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        actual_cost DOUBLE PRECISION,
        estimated_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        id UUID PRIMARY KEY,
        pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        agent TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT,
        generation_id TEXT,
        status TEXT NOT NULL,
        input_json JSONB NOT NULL,
        output_json JSONB,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        actual_cost DOUBLE PRECISION,
        estimated_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        error TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS candidates (
        id UUID PRIMARY KEY,
        pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        taxonomy TEXT NOT NULL,
        data_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS critic_evaluations (
        id UUID PRIMARY KEY,
        pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        recommendation TEXT NOT NULL,
        data_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS strategist_evaluations (
        id UUID PRIMARY KEY,
        pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        final_score INTEGER NOT NULL,
        readiness_status TEXT NOT NULL,
        data_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS editorial_briefs (
        id UUID PRIMARY KEY,
        pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        rank INTEGER NOT NULL,
        score INTEGER NOT NULL,
        status TEXT NOT NULL,
        data_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS drafting_sessions (
        id UUID PRIMARY KEY,
        pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        requested_platforms JSONB NOT NULL,
        evidence TEXT NOT NULL DEFAULT '',
        guidance TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        models_json JSONB NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        actual_cost DOUBLE PRECISION,
        estimated_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        error TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS draft_agent_runs (
        id UUID PRIMARY KEY,
        drafting_session_id UUID NOT NULL REFERENCES drafting_sessions(id) ON DELETE CASCADE,
        agent TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT,
        generation_id TEXT,
        status TEXT NOT NULL,
        input_json JSONB NOT NULL,
        output_json JSONB,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        actual_cost DOUBLE PRECISION,
        estimated_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        error TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS social_draft_revisions (
        id UUID PRIMARY KEY,
        drafting_session_id UUID NOT NULL REFERENCES drafting_sessions(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        revision INTEGER NOT NULL,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        repair_prompt TEXT,
        character_count INTEGER NOT NULL,
        review_state TEXT NOT NULL,
        review_json JSONB,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        deleted_by TEXT,
        deleted_at TIMESTAMPTZ,
        UNIQUE (drafting_session_id, platform, revision)
      );

      ALTER TABLE social_draft_revisions
        ADD COLUMN IF NOT EXISTS repair_prompt TEXT;
      ALTER TABLE social_draft_revisions
        ADD COLUMN IF NOT EXISTS deleted_by TEXT;
      ALTER TABLE social_draft_revisions
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

      UPDATE social_draft_revisions AS revision
      SET repair_prompt = agent_run.input_json #>> '{request,instructions}'
      FROM draft_agent_runs AS agent_run
      WHERE revision.drafting_session_id = agent_run.drafting_session_id
        AND revision.source = 'REPAIR'
        AND revision.repair_prompt IS NULL
        AND NULLIF(agent_run.input_json #>> '{request,instructions}', '') IS NOT NULL
        AND agent_run.input_json #>> '{request,platform}' = revision.platform
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(agent_run.output_json -> 'drafts', '[]'::jsonb)
          ) AS generated_draft
          WHERE generated_draft ->> 'platform' = revision.platform
            AND generated_draft ->> 'content' = revision.content
        );

      CREATE TABLE IF NOT EXISTS buffer_deliveries (
        id UUID PRIMARY KEY,
        draft_revision_id UUID NOT NULL REFERENCES social_draft_revisions(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        channel_service TEXT NOT NULL,
        status TEXT NOT NULL,
        buffer_post_id TEXT,
        error TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        UNIQUE (draft_revision_id, channel_id)
      );

      CREATE TABLE IF NOT EXISTS app_secrets (
        name TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        display_hint TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_agent_runs_pipeline ON agent_runs(pipeline_run_id);
      CREATE INDEX IF NOT EXISTS idx_candidates_pipeline ON candidates(pipeline_run_id);
      CREATE INDEX IF NOT EXISTS idx_briefs_pipeline ON editorial_briefs(pipeline_run_id, rank);
      CREATE INDEX IF NOT EXISTS idx_runs_created ON pipeline_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_draft_sessions_brief
        ON drafting_sessions(pipeline_run_id, candidate_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_draft_revisions_session
        ON social_draft_revisions(drafting_session_id, platform, revision DESC);
      CREATE INDEX IF NOT EXISTS idx_draft_agent_runs_session
        ON draft_agent_runs(drafting_session_id);
      CREATE INDEX IF NOT EXISTS idx_buffer_deliveries_revision
        ON buffer_deliveries(draft_revision_id, created_at DESC);

      INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT (version) DO NOTHING;
      INSERT INTO schema_migrations (version) VALUES (2) ON CONFLICT (version) DO NOTHING;
      INSERT INTO schema_migrations (version) VALUES (3) ON CONFLICT (version) DO NOTHING;
      INSERT INTO schema_migrations (version) VALUES (4) ON CONFLICT (version) DO NOTHING;
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function ensureDatabase(): Promise<void> {
  if (!globalThis.__axelynSignalDbReady) {
    globalThis.__axelynSignalDbReady = (async () => {
      const client = await getPool().connect();
      try {
        await migrate(client);
      } finally {
        client.release();
      }
    })().catch((error) => {
      globalThis.__axelynSignalDbReady = undefined;
      throw error;
    });
  }
  return globalThis.__axelynSignalDbReady;
}

export async function checkDatabase(): Promise<void> {
  await ensureDatabase();
  await getPool().query("SELECT 1");
}

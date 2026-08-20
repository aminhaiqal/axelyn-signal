import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

declare global {
  var __axelynSignalDb: DatabaseSync | undefined;
}

function databasePath(): string {
  const configured = process.env.AXELYN_DATABASE_PATH ?? ".data/axelyn-signal.db";
  return configured === ":memory:"
    ? configured
    : resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

function initialize(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      scout_output TEXT,
      models_json TEXT NOT NULL,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      actual_cost REAL,
      estimated_cost REAL NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT,
      generation_id TEXT,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_json TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      actual_cost REAL,
      estimated_cost REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      taxonomy TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS critic_evaluations (
      id TEXT PRIMARY KEY,
      pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      recommendation TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategist_evaluations (
      id TEXT PRIMARY KEY,
      pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      final_score INTEGER NOT NULL,
      readiness_status TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS editorial_briefs (
      id TEXT PRIMARY KEY,
      pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      rank INTEGER NOT NULL,
      score INTEGER NOT NULL,
      status TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_pipeline ON agent_runs(pipeline_run_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_pipeline ON candidates(pipeline_run_id);
    CREATE INDEX IF NOT EXISTS idx_briefs_pipeline ON editorial_briefs(pipeline_run_id, rank);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON pipeline_runs(created_at DESC);
  `);
}

export function getDatabase(): DatabaseSync {
  if (globalThis.__axelynSignalDb) return globalThis.__axelynSignalDb;

  const path = databasePath();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  initialize(db);
  globalThis.__axelynSignalDb = db;
  return db;
}

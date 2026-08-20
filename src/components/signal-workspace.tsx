"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FinalBrief,
  PipelineResult,
  SignalInput,
  ScoutOutput,
} from "@/domain/schemas";
import type { PipelineEvent } from "@/pipeline/events";
import type { RecentRun, StoredRun } from "@/persistence/types";
import { ArrowUpRight, Chevron, Plus, SignalMark } from "./icons";

type AgentName = "scout" | "explorer" | "critic" | "strategist";
type StageStatus = "idle" | "active" | "done" | "skipped";
type AppStatus = "idle" | "running" | "complete" | "stopped" | "error";

const AGENTS: Array<{ id: AgentName; name: string; responsibility: string }> = [
  { id: "scout", name: "Scout", responsibility: "Qualify the signal" },
  { id: "explorer", name: "Explorer", responsibility: "Find distinct angles" },
  { id: "critic", name: "Critic", responsibility: "Attack weak ideas" },
  { id: "strategist", name: "Strategist", responsibility: "Rank business value" },
];

const SOURCE_OPTIONS: Array<{ value: SignalInput["source_type"]; label: string }> = [
  { value: "observation", label: "Observation" },
  { value: "conversation", label: "Conversation" },
  { value: "project_lesson", label: "Project lesson" },
  { value: "business_trend", label: "Business trend" },
  { value: "external_signal", label: "External signal" },
  { value: "other", label: "Other" },
];

const initialSignal = "AI coding makes implementation much faster, but companies can still build the wrong thing.";
const initialContext = "Thinking about how AI changes software engineering.";

function blankStages(): Record<AgentName, StageStatus> {
  return { scout: "idle", explorer: "idle", critic: "idle", strategist: "idle" };
}

function shortModel(model: string): string {
  return model.split("/").at(-1)?.replaceAll("-", " ") ?? model;
}

function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function relativeDate(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").toLowerCase();
}

export function SignalWorkspace() {
  const [sourceType, setSourceType] = useState<SignalInput["source_type"]>("observation");
  const [content, setContent] = useState(initialSignal);
  const [context, setContext] = useState(initialContext);
  const [status, setStatus] = useState<AppStatus>("idle");
  const [stages, setStages] = useState<Record<AgentName, StageStatus>>(blankStages);
  const [stageNotes, setStageNotes] = useState<Partial<Record<AgentName, string>>>({});
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<RecentRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);
  const [models, setModels] = useState<Record<string, string>>({});

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/runs?limit=10");
      if (!response.ok) return;
      const data = (await response.json()) as { runs: RecentRun[] };
      setRuns(data.runs);
    } catch {
      // History is secondary; keep the working surface available if it cannot load.
    }
  }, []);

  useEffect(() => {
    void fetch("/api/runs?limit=10")
      .then((response) => response.ok ? response.json() : { runs: [] })
      .then((data: { runs: RecentRun[] }) => setRuns(data.runs))
      .catch(() => undefined);
    void fetch("/api/config")
      .then((response) => response.json())
      .then((data: { openrouter_configured: boolean; models: Record<string, string> }) => {
        setApiConfigured(data.openrouter_configured);
        setModels(data.models);
      })
      .catch(() => setApiConfigured(false));
  }, [loadRuns]);

  const progress = useMemo(() => {
    const complete = Object.values(stages).filter((stage) => stage === "done").length;
    const activeIndex = AGENTS.findIndex((agent) => stages[agent.id] === "active");
    return activeIndex >= 0 ? (activeIndex / (AGENTS.length - 1)) * 100 : (complete / AGENTS.length) * 100;
  }, [stages]);

  function handleEvent(event: PipelineEvent) {
    if (event.type === "run_started") {
      setActiveRunId(event.run_id);
      setModels(event.models);
    }
    if (event.type === "stage_started") {
      setStages((current) => ({ ...current, [event.stage]: "active" }));
    }
    if (event.type === "stage_completed") {
      setStages((current) => ({ ...current, [event.stage]: "done" }));
      setStageNotes((current) => ({ ...current, [event.stage]: event.summary }));
    }
    if (event.type === "pipeline_completed") {
      setResult(event.result);
      setActiveRunId(event.run_id);
      setStatus(event.result.status === "STOPPED" ? "stopped" : "complete");
      if (event.result.status === "STOPPED") {
        setStages((current) => ({ ...current, explorer: "skipped", critic: "skipped", strategist: "skipped" }));
      }
    }
    if (event.type === "pipeline_failed") {
      setError(event.error);
      setStatus("error");
      setStages((current) => {
        const next = { ...current };
        for (const agent of AGENTS) if (next[agent.id] === "active") next[agent.id] = "idle";
        return next;
      });
    }
  }

  async function runSignal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (content.trim().length < 12 || status === "running") return;

    setStatus("running");
    setStages(blankStages());
    setStageNotes({});
    setResult(null);
    setError("");
    setActiveRunId(null);

    try {
      const response = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: sourceType, content, context }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "The pipeline could not start.");
      }
      if (!response.body) throw new Error("The pipeline stream was unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) handleEvent(JSON.parse(line) as PipelineEvent);
        }
        if (done) break;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The pipeline failed unexpectedly.");
      setStatus("error");
    } finally {
      void loadRuns();
    }
  }

  async function openRun(id: string) {
    if (status === "running") return;
    try {
      const response = await fetch(`/api/runs/${id}`);
      if (!response.ok) throw new Error("That run could not be loaded.");
      const { run } = (await response.json()) as { run: StoredRun };
      setSourceType(run.source_type);
      setContent(run.content);
      setContext(run.context);
      setActiveRunId(run.id);
      setModels(run.models);
      setError(run.error ?? "");
      if (run.scout) {
        setResult({
          run_id: run.id,
          status: run.status === "STOPPED" ? "STOPPED" : "COMPLETED",
          scout: run.scout,
          briefs: run.briefs,
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: run.total_tokens,
            reasoning_tokens: 0,
            cached_tokens: 0,
            cost: run.actual_cost,
            estimated_cost: run.estimated_cost,
          },
          models: run.models,
        });
      } else {
        setResult(null);
      }
      setStatus(
        run.status === "FAILED" ? "error" : run.status === "STOPPED" ? "stopped" : "complete",
      );
      setStages(
        run.status === "STOPPED"
          ? { scout: "done", explorer: "skipped", critic: "skipped", strategist: "skipped" }
          : run.status === "COMPLETED"
            ? { scout: "done", explorer: "done", critic: "done", strategist: "done" }
            : blankStages(),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That run could not be loaded.");
      setStatus("error");
    }
  }

  function newSignal() {
    if (status === "running") return;
    setContent("");
    setContext("");
    setSourceType("observation");
    setStatus("idle");
    setResult(null);
    setError("");
    setActiveRunId(null);
    setStages(blankStages());
    setStageNotes({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark"><SignalMark /></span>
          <span className="brand-name">Axelyn</span>
          <span className="brand-product">Signal</span>
        </div>

        <button className="new-signal" type="button" onClick={newSignal} disabled={status === "running"}>
          <Plus />
          New signal
        </button>

        <nav className="history" aria-label="Recent pipeline runs">
          <div className="rail-heading">
            <span>Recent runs</span>
            <span>{runs.length}</span>
          </div>
          <div className="history-list">
            {runs.length === 0 ? (
              <p className="history-empty">Completed runs will appear here.</p>
            ) : runs.map((run) => (
              <button
                type="button"
                className={`history-item ${activeRunId === run.id ? "is-current" : ""}`}
                key={run.id}
                onClick={() => void openRun(run.id)}
              >
                <span className="history-copy">{run.content}</span>
                <span className="history-meta">
                  <span>{relativeDate(run.created_at)}</span>
                  <span>{run.brief_count} briefs</span>
                </span>
                <ArrowUpRight className="history-arrow" />
              </button>
            ))}
          </div>
        </nav>

        <div className="human-note">
          <span className="human-dot" />
          <div><strong>Human review required</strong><span>Signal never publishes content.</span></div>
        </div>
      </aside>

      <main className="main-workspace">
        <header className="topbar">
          <div>
            <span className="topbar-kicker">Content intelligence</span>
            <span className="topbar-separator">/</span>
            <span className="topbar-location">Editorial workspace</span>
          </div>
          <div className={`gateway-status ${apiConfigured ? "is-ready" : ""}`}>
            <span />
            {apiConfigured === null ? "Checking gateway" : apiConfigured ? "OpenRouter connected" : "API key needed"}
          </div>
        </header>

        <div className="workspace-content">
          <section className="composer" aria-labelledby="signal-heading">
            <div className="section-intro">
              <div>
                <span className="eyebrow">Raw input</span>
                <h1 id="signal-heading">What did you notice?</h1>
              </div>
              <p>Capture the observation as it is. The pipeline will find the editorial value.</p>
            </div>

            <form onSubmit={runSignal}>
              <div className="signal-field">
                <textarea
                  aria-label="Raw signal"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="A project lesson, customer conversation, business shift, or observation…"
                  maxLength={6000}
                  disabled={status === "running"}
                />
                <span className="character-count">{content.length} / 6,000</span>
              </div>

              <div className="composer-controls">
                <label>
                  <span>Source type</span>
                  <select
                    value={sourceType}
                    onChange={(event) => setSourceType(event.target.value as SignalInput["source_type"])}
                    disabled={status === "running"}
                  >
                    {SOURCE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="context-control">
                  <span>Optional context</span>
                  <input
                    value={context}
                    onChange={(event) => setContext(event.target.value)}
                    placeholder="What prompted this thought?"
                    maxLength={4000}
                    disabled={status === "running"}
                  />
                </label>
                <button className="run-button" type="submit" disabled={content.trim().length < 12 || status === "running"}>
                  {status === "running" ? "Running pipeline" : "Develop this signal"}
                  <ArrowUpRight />
                </button>
              </div>
            </form>

            {apiConfigured === false && (
              <div className="config-notice" role="status">
                Add <code>OPENROUTER_API_KEY</code> to <code>.env.local</code> before running the pipeline.
              </div>
            )}
          </section>

          <PipelineTrace stages={stages} stageNotes={stageNotes} progress={progress} models={models} running={status === "running"} />

          {error && <div className="error-banner" role="alert"><strong>Pipeline stopped.</strong> {error}</div>}

          {result?.status === "STOPPED" && <StoppedSignal scout={result.scout} />}
          {result?.status === "COMPLETED" && (
            <Results result={result} />
          )}

          {!result && status === "idle" && (
            <section className="empty-state" aria-label="How the pipeline works">
              <span className="eyebrow">Expected output</span>
              <p>Three to five ranked editorial briefs—claims, audiences, counterarguments, evidence needs, and platform direction. Never full posts.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function PipelineTrace({
  stages,
  stageNotes,
  progress,
  models,
  running,
}: {
  stages: Record<AgentName, StageStatus>;
  stageNotes: Partial<Record<AgentName, string>>;
  progress: number;
  models: Record<string, string>;
  running: boolean;
}) {
  return (
    <section className={`pipeline-trace ${running ? "is-running" : ""}`} aria-label="Pipeline progress">
      <div className="trace-heading">
        <span className="eyebrow">Pipeline</span>
        <span>{running ? "Models are working in sequence" : "Bounded specialists, controlled by one orchestrator"}</span>
      </div>
      <div className="trace-stages" style={{ "--trace-progress": `${progress}%` } as React.CSSProperties}>
        <div className="trace-line"><span /></div>
        {AGENTS.map((agent, index) => (
          <div className={`trace-stage is-${stages[agent.id]}`} key={agent.id}>
            <span className="stage-node">{stages[agent.id] === "done" ? "✓" : index + 1}</span>
            <div>
              <div className="stage-name">{agent.name}</div>
              <div className="stage-detail">{stageNotes[agent.id] ?? agent.responsibility}</div>
              {models[agent.id] && <div className="stage-model">{shortModel(models[agent.id])}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StoppedSignal({ scout }: { scout: ScoutOutput }) {
  return (
    <section className="stopped-signal">
      <span className="eyebrow">Scout decision</span>
      <h2>This signal needs more substance.</h2>
      <p>{scout.stop_reason || "Scout could not find enough tension or editorial potential to justify more model calls."}</p>
      <div className="quality-scores">
        {Object.entries(scout.quality).map(([label, score]) => (
          <span key={label}><strong>{score}</strong>{label.replaceAll("_", " ")}</span>
        ))}
      </div>
    </section>
  );
}

function Results({ result }: { result: PipelineResult }) {
  const cost = result.usage.cost ?? result.usage.estimated_cost;
  return (
    <section className="results" aria-labelledby="results-heading">
      <div className="results-header">
        <div>
          <span className="eyebrow">Final idea briefs</span>
          <h2 id="results-heading">{result.briefs.length} ideas worth considering</h2>
        </div>
        <div className="run-metadata">
          <span><strong>{result.usage.total_tokens.toLocaleString()}</strong> tokens</span>
          <span><strong>{formatCost(cost)}</strong> run cost</span>
        </div>
      </div>

      {result.briefs.length === 0 ? (
        <p className="no-briefs">Critic or Strategist rejected every candidate. That is a valid result—refine the raw signal instead of publishing a weak idea.</p>
      ) : (
        <div className="brief-list">
          {result.briefs.map((brief) => <BriefItem brief={brief} key={brief.candidate_id} />)}
        </div>
      )}
    </section>
  );
}

function BriefItem({ brief }: { brief: FinalBrief }) {
  return (
    <details className="brief-item">
      <summary>
        <span className="brief-rank">{String(brief.rank).padStart(2, "0")}</span>
        <span className="brief-title-block">
          <span className="brief-labels">
            <span className="taxonomy">{brief.primary_job}</span>
            <span className={`readiness is-${brief.status.toLowerCase()}`}>{statusLabel(brief.status)}</span>
          </span>
          <span className="brief-title">{brief.title}</span>
          <span className="brief-audience">For {brief.target_audience.join(", ")}</span>
        </span>
        <span className="brief-score"><strong>{brief.score}</strong><span>/ 100</span></span>
        <Chevron className="brief-chevron" />
      </summary>
      <div className="brief-body">
        <div className="claim-block">
          <span>Core claim</span>
          <p>{brief.core_claim}</p>
        </div>
        <div className="brief-grid">
          <BriefField label="Why people care" value={brief.why_people_care} />
          <BriefField label="Reader takeaway" value={brief.reader_takeaway} />
          <BriefField label="Axelyn’s right to speak" value={brief.axelyn_right_to_speak} />
          <BriefField label="Counterargument" value={brief.counterargument} />
        </div>
        {brief.evidence_needed.length > 0 && (
          <div className="evidence-block">
            <span>Evidence before publication</span>
            <ul>{brief.evidence_needed.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        )}
        <div className="platform-directions">
          <BriefField label="LinkedIn direction" value={brief.linkedin_angle} />
          <BriefField label="Threads direction" value={brief.threads_angle} />
        </div>
      </div>
    </details>
  );
}

function BriefField({ label, value }: { label: string; value: string }) {
  return <div className="brief-field"><span>{label}</span><p>{value}</p></div>;
}

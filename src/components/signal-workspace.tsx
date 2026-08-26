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
import { DraftStudio } from "./draft-studio";
import {
  ArrowUpRight,
  Chevron,
  CloseIcon,
  EyeIcon,
  Plus,
  SettingsIcon,
  SignalMark,
} from "./icons";

type AgentName = "scout" | "explorer" | "critic" | "strategist";
type StageStatus = "idle" | "active" | "done" | "skipped";
type AppStatus = "idle" | "running" | "complete" | "stopped" | "error";

interface OpenRouterKeyStatus {
  configured: boolean;
  encryption_ready: boolean;
  display_hint: string | null;
  updated_at: string | null;
}

const AGENTS: Array<{ id: AgentName; name: string; responsibility: string; support: string }> = [
  {
    id: "scout",
    name: "Scout",
    responsibility: "Qualify the signal",
    support: "Stops weak signals before the rest of the run spends tokens.",
  },
  {
    id: "explorer",
    name: "Explorer",
    responsibility: "Find distinct angles",
    support: "Turns a qualified signal into a constrained set of editorial directions.",
  },
  {
    id: "critic",
    name: "Critic",
    responsibility: "Attack weak ideas",
    support: "Challenges soft claims, generic framing, and angles that collapse under pressure.",
  },
  {
    id: "strategist",
    name: "Strategist",
    responsibility: "Rank business value",
    support: "Scores the survivors for business value and editorial readiness.",
  },
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

function stageStatusLabel(status: StageStatus): string {
  switch (status) {
    case "active":
      return "Running";
    case "done":
      return "Complete";
    case "skipped":
      return "Skipped";
    default:
      return "Queued";
  }
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
  const [operatorEmail, setOperatorEmail] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<OpenRouterKeyStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setApiKeyInput("");
    setShowApiKey(false);
    setSettingsError("");
    setSettingsMessage("");
  }, []);

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
      .then((data: {
        openrouter_configured: boolean;
        openrouter: OpenRouterKeyStatus | null;
        models: Record<string, string>;
        operator_email: string | null;
      }) => {
        setApiConfigured(data.openrouter_configured);
        setKeyStatus(data.openrouter);
        setModels(data.models);
        setOperatorEmail(data.operator_email);
      })
      .catch(() => setApiConfigured(false));
  }, [loadRuns]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeSettings, settingsOpen]);

  async function openSettings() {
    setSettingsOpen(true);
    setSettingsLoading(true);
    setSettingsError("");
    setSettingsMessage("");
    try {
      const response = await fetch("/api/settings/openrouter", { cache: "no-store" });
      const data = (await response.json()) as { openrouter?: OpenRouterKeyStatus; error?: string };
      if (!response.ok || !data.openrouter) throw new Error(data.error ?? "Settings could not be loaded.");
      setKeyStatus(data.openrouter);
      setApiConfigured(data.openrouter.configured && data.openrouter.encryption_ready);
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : "Settings could not be loaded.");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function saveApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsLoading(true);
    setSettingsError("");
    setSettingsMessage("");
    try {
      const response = await fetch("/api/settings/openrouter", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKeyInput }),
      });
      const data = (await response.json()) as { openrouter?: OpenRouterKeyStatus; error?: string };
      if (!response.ok || !data.openrouter) throw new Error(data.error ?? "The API key could not be saved.");
      setKeyStatus(data.openrouter);
      setApiConfigured(data.openrouter.configured && data.openrouter.encryption_ready);
      setApiKeyInput("");
      setShowApiKey(false);
      setSettingsMessage("OpenRouter key saved.");
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : "The API key could not be saved.");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function removeApiKey() {
    if (!window.confirm("Remove the stored OpenRouter API key? Pipeline runs will stop until a new key is saved.")) return;
    setSettingsLoading(true);
    setSettingsError("");
    setSettingsMessage("");
    try {
      const response = await fetch("/api/settings/openrouter", { method: "DELETE" });
      const data = (await response.json()) as { openrouter?: OpenRouterKeyStatus; error?: string };
      if (!response.ok || !data.openrouter) throw new Error(data.error ?? "The API key could not be removed.");
      setKeyStatus(data.openrouter);
      setApiConfigured(false);
      setSettingsMessage("OpenRouter key removed.");
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : "The API key could not be removed.");
    } finally {
      setSettingsLoading(false);
    }
  }

  const progress = useMemo(() => {
    const complete = Object.values(stages).filter((stage) => stage === "done").length;
    const activeIndex = AGENTS.findIndex((agent) => stages[agent.id] === "active");
    if (activeIndex >= 0) {
      return ((activeIndex + 0.45) / AGENTS.length) * 100;
    }
    return (complete / AGENTS.length) * 100;
  }, [stages]);

  function handleEvent(event: PipelineEvent) {
    if (event.type === "run_started") {
      setActiveRunId(event.run_id);
      setModels((current) => ({ ...current, ...event.models }));
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
      setModels((current) => ({ ...current, ...run.models }));
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

        <div className="sidebar-actions">
          <button className="new-signal" type="button" onClick={newSignal} disabled={status === "running"}>
            <Plus />
            New signal
          </button>
        </div>

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

        <button className="settings-trigger" type="button" onClick={() => void openSettings()}>
          <SettingsIcon />
          <span>Settings</span>
          <span className={`settings-key-dot ${apiConfigured ? "is-ready" : ""}`} />
        </button>

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
          <button className={`gateway-status ${apiConfigured ? "is-ready" : ""}`} type="button" onClick={() => void openSettings()}>
            <span />
            {apiConfigured === null ? "Checking gateway" : apiConfigured ? "OpenRouter ready" : "OpenRouter setup needed"}
          </button>
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
                Add an OpenRouter API key in <button type="button" onClick={() => void openSettings()}>Settings</button> before running the pipeline.
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
              <p>Three to five ranked editorial briefs first. Open a qualified brief when you are ready to commission platform-native writing.</p>
            </section>
          )}
        </div>
      </main>

      <SettingsVault
        open={settingsOpen}
        onClose={closeSettings}
        onSave={saveApiKey}
        onRemove={() => void removeApiKey()}
        status={keyStatus}
        loading={settingsLoading}
        error={settingsError}
        message={settingsMessage}
        apiKey={apiKeyInput}
        setApiKey={setApiKeyInput}
        showApiKey={showApiKey}
        setShowApiKey={setShowApiKey}
        models={models}
        operatorEmail={operatorEmail}
      />
    </div>
  );
}

function SettingsVault({
  open,
  onClose,
  onSave,
  onRemove,
  status,
  loading,
  error,
  message,
  apiKey,
  setApiKey,
  showApiKey,
  setShowApiKey,
  models,
  operatorEmail,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onRemove: () => void;
  status: OpenRouterKeyStatus | null;
  loading: boolean;
  error: string;
  message: string;
  apiKey: string;
  setApiKey: (value: string) => void;
  showApiKey: boolean;
  setShowApiKey: (value: boolean) => void;
  models: Record<string, string>;
  operatorEmail: string | null;
}) {
  return (
    <div className={`settings-layer ${open ? "is-open" : ""}`} aria-hidden={!open} inert={!open}>
      <button className="settings-scrim" type="button" onClick={onClose} tabIndex={open ? 0 : -1} aria-label="Close settings" />
      <aside className="settings-vault" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="vault-header">
          <div>
            <span className="eyebrow">Credential vault</span>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button className="vault-close" type="button" onClick={onClose} aria-label="Close settings"><CloseIcon /></button>
        </header>

        <div className="vault-scroll">
          <section className="vault-section">
            <div className="vault-section-heading">
              <div><span>OpenRouter</span><p>One active gateway key for all bounded agents.</p></div>
              <span className={`vault-status ${status?.configured && status.encryption_ready ? "is-ready" : ""}`}>
                {status?.configured && status.encryption_ready ? "Ready" : "Setup needed"}
              </span>
            </div>

            {status?.configured && (
              <div className="stored-key-row">
                <div><span>Stored key</span><strong>{status.display_hint}</strong></div>
                <button type="button" onClick={onRemove} disabled={loading}>Remove</button>
              </div>
            )}

            <form className="key-form" onSubmit={onSave}>
              <label htmlFor="openrouter-key">{status?.configured ? "Replace API key" : "API key"}</label>
              <div className="secret-input">
                <input
                  id="openrouter-key"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  type={showApiKey ? "text" : "password"}
                  placeholder="sk-or-v1-…"
                  autoComplete="off"
                  spellCheck={false}
                  minLength={20}
                  maxLength={512}
                  disabled={loading}
                />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)} aria-label={showApiKey ? "Hide API key" : "Show API key"}>
                  <EyeIcon crossed={showApiKey} />
                </button>
              </div>
              <button className="save-key-button" type="submit" disabled={loading || apiKey.trim().length < 20}>
                {loading ? "Saving…" : status?.configured ? "Replace key" : "Save key"}
              </button>
            </form>

            {!status?.encryption_ready && (
              <p className="vault-warning">Set <code>SETTINGS_ENCRYPTION_KEY</code> on the server before saving credentials.</p>
            )}
            {error && <p className="vault-error" role="alert">{error}</p>}
            {message && <p className="vault-success" role="status">{message}</p>}
            <p className="encryption-note">The key is encrypted with AES-256-GCM before PostgreSQL storage. It is never returned to this browser after saving.</p>
          </section>

          <section className="vault-section">
            <div className="vault-section-heading">
              <div><span>Agent models</span><p>Configured at deployment and shown here for audit.</p></div>
            </div>
            <div className="model-roster">
              {AGENTS.map((agent) => (
                <div key={agent.id}><span>{agent.name}</span><strong>{models[agent.id] ?? "Not configured"}</strong></div>
              ))}
            </div>
          </section>

          <section className="vault-section">
            <div className="vault-section-heading">
              <div><span>Drafting models</span><p>Writing and review remain separate editorial responsibilities.</p></div>
            </div>
            <div className="model-roster">
              <div><span>Drafter</span><strong>{models.drafter ?? "Not configured"}</strong></div>
              <div><span>Reviewer</span><strong>{models.reviewer ?? "Not configured"}</strong></div>
            </div>
          </section>

          <section className="vault-section access-section">
            <div className="vault-section-heading">
              <div><span>Access boundary</span><p>Authentication is enforced before traffic reaches the application.</p></div>
            </div>
            <div className="access-identity"><span>Current operator</span><strong>{operatorEmail ?? "Local development session"}</strong></div>
            <p>Production traffic should reach this container only through a Cloudflare Tunnel protected by an Access policy.</p>
          </section>
        </div>
      </aside>
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
  const completedCount = AGENTS.filter((agent) => stages[agent.id] === "done").length;
  const skippedCount = AGENTS.filter((agent) => stages[agent.id] === "skipped").length;
  const activeAgent = AGENTS.find((agent) => stages[agent.id] === "active") ?? null;
  const traceState = running
    ? "running"
    : skippedCount > 0
      ? "stopped"
      : completedCount === AGENTS.length
        ? "complete"
        : "idle";
  const traceSummary = running
    ? `${activeAgent?.name ?? "Pipeline"} is working now.`
    : traceState === "stopped"
      ? "Scout stopped the run before more model spend."
      : traceState === "complete"
        ? "All four specialist passes finished."
        : "The orchestrator is waiting for a signal.";
  const traceSupport = running
    ? `${completedCount} of ${AGENTS.length} stages completed. Outputs unlock the next pass in sequence.`
    : traceState === "stopped"
      ? "Explorer, Critic, and Strategist stay dormant when the initial signal does not clear qualification."
      : traceState === "complete"
        ? "Surviving ideas below were already pressure-tested before scoring."
        : "Scout can end the run after the first pass when the signal is too weak to justify more calls.";

  return (
    <section className={`pipeline-trace is-${traceState}`} aria-label="Pipeline progress">
      <div className="trace-heading">
        <div className="trace-heading-copy">
          <span className="eyebrow">Pipeline</span>
          <h2 className="trace-title">Four bounded passes, one editorial decision.</h2>
          <p className="trace-description">The orchestrator advances one specialist at a time, validates each output, and stops early when the signal does not warrant more model spend.</p>
        </div>
        <div className={`trace-summary is-${traceState}`}>
          <span className="trace-summary-state">{running ? "Running" : traceState === "complete" ? "Complete" : traceState === "stopped" ? "Stopped" : "Standby"}</span>
          <strong>{traceSummary}</strong>
          <span>{traceSupport}</span>
        </div>
      </div>
      <div className="trace-board" style={{ "--trace-progress": `${progress}%` } as React.CSSProperties}>
        <div className="trace-progress" aria-hidden="true"><span /></div>
        <div className="trace-grid">
          <div className="orchestrator-lane">
            <span className="trace-board-label">Control</span>
            <strong>Single orchestrator</strong>
            <p>Owns sequencing, schema checks, score assembly, and the rule that Scout can halt the run before the later specialists activate.</p>
            <div className="orchestrator-meta">
              <span>Flow</span>
              <strong>Scout → Explorer → Critic → Strategist</strong>
            </div>
          </div>

          <ol className="trace-stages">
            {AGENTS.map((agent, index) => (
              <li className={`trace-stage is-${stages[agent.id]}`} key={agent.id}>
                <div className="stage-topline">
                  <span className="stage-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className={`stage-state is-${stages[agent.id]}`}>{stageStatusLabel(stages[agent.id])}</span>
                </div>
                <div className="stage-name">{agent.name}</div>
                <div className="stage-role">{agent.responsibility}</div>
                <p className="stage-detail">{stageNotes[agent.id] ?? agent.support}</p>
                {models[agent.id] && (
                  <div className="stage-model">
                    <span>Model</span>
                    <strong>{shortModel(models[agent.id])}</strong>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
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
          {result.briefs.map((brief) => (
            <BriefItem brief={brief} runId={result.run_id} key={brief.candidate_id} />
          ))}
        </div>
      )}
    </section>
  );
}

function BriefItem({ brief, runId }: { brief: FinalBrief; runId: string }) {
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
        <DraftStudio runId={runId} brief={brief} />
      </div>
    </details>
  );
}

function BriefField({ label, value }: { label: string; value: string }) {
  return <div className="brief-field"><span>{label}</span><p>{value}</p></div>;
}

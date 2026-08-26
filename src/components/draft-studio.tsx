"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  DraftPlatform,
  DraftSession,
} from "@/domain/drafts";
import type { FinalBrief } from "@/domain/schemas";
import type { DraftingEvent as StreamDraftingEvent } from "@/drafting/events";

const PLATFORM_LIMITS: Record<DraftPlatform, number> = {
  LINKEDIN: 3000,
  THREADS: 500,
};

type DraftStage = "idle" | "drafter" | "reviewer" | "repair" | "complete";

function platformLabel(platform: DraftPlatform): string {
  return platform === "LINKEDIN" ? "LinkedIn" : "Threads";
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The draft could not be generated.";
  return message === "Load failed" || message.includes("Failed to fetch")
    ? "The connection ended before the proof returned. Reload the page to recover any session that finished in the background."
    : message;
}

function initialPlatforms(brief: FinalBrief): DraftPlatform[] {
  if (brief.recommended_platform === "BOTH") return ["LINKEDIN", "THREADS"];
  return [brief.recommended_platform];
}

export function DraftStudio({ runId, brief }: { runId: string; brief: FinalBrief }) {
  const [studioOpen, setStudioOpen] = useState(false);
  const [platforms, setPlatforms] = useState<DraftPlatform[]>(() => initialPlatforms(brief));
  const [evidence, setEvidence] = useState("");
  const [guidance, setGuidance] = useState("");
  const [sessions, setSessions] = useState<DraftSession[]>([]);
  const [session, setSession] = useState<DraftSession | null>(null);
  const [activePlatform, setActivePlatform] = useState<DraftPlatform>(initialPlatforms(brief)[0]);
  const [editorValues, setEditorValues] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<DraftStage>("idle");
  const [stageSummary, setStageSummary] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [working, setWorking] = useState(false);
  const [action, setAction] = useState<"save" | "review" | "approve" | "copy" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch(
        `/api/runs/${runId}/briefs/${brief.candidate_id}/drafts`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as { sessions?: DraftSession[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Previous proofs could not be loaded.");
      const loaded = data.sessions ?? [];
      setSessions(loaded);
      if (loaded[0]) {
        setSession((current) => current ?? loaded[0]);
        setActivePlatform((current) =>
          loaded[0].requested_platforms.includes(current)
            ? current
            : loaded[0].requested_platforms[0]
        );
      }
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setLoadingHistory(false);
    }
  }, [brief.candidate_id, runId]);

  const platformView = session?.drafts.find((draft) => draft.platform === activePlatform) ?? null;
  const currentRevision = platformView?.current ?? null;
  const editorValue = currentRevision
    ? editorValues[currentRevision.id] ?? currentRevision.content
    : "";

  const characterCount = unicodeLength(editorValue);
  const platformLimit = PLATFORM_LIMITS[activePlatform];
  const changed = Boolean(currentRevision && editorValue !== currentRevision.content);
  const overLimit = characterCount > platformLimit;

  const stageIndex = useMemo(() => {
    if (stage === "drafter") return 1;
    if (stage === "reviewer") return 2;
    if (stage === "repair" || stage === "complete") return 3;
    return 0;
  }, [stage]);

  function togglePlatform(platform: DraftPlatform) {
    setPlatforms((current) => {
      if (current.includes(platform)) {
        return current.length === 1 ? current : current.filter((item) => item !== platform);
      }
      return platform === "LINKEDIN"
        ? ["LINKEDIN", ...current]
        : [...current, "THREADS"];
    });
  }

  function chooseSession(next: DraftSession) {
    setSession(next);
    setActivePlatform(next.requested_platforms[0]);
    setError("");
    setCopied(false);
  }

  function toggleStudio() {
    const nextOpen = !studioOpen;
    setStudioOpen(nextOpen);
    if (nextOpen && sessions.length === 0 && !loadingHistory) void loadSessions();
  }

  async function generateDrafts() {
    if (working) return;
    setWorking(true);
    setError("");
    setStage("drafter");
    setStageSummary("Drafter is shaping the approved brief into native posts.");
    try {
      const response = await fetch(
        `/api/runs/${runId}/briefs/${brief.candidate_id}/drafts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platforms, evidence, guidance }),
        },
      );
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Drafting could not start.");
      }
      if (!response.body) throw new Error("The drafting stream was unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamDraftingEvent | { type: "heartbeat" };
          if (event.type === "draft_stage_started") {
            setStage(event.stage === "drafter" ? "drafter" : event.stage);
            setStageSummary(
              event.stage === "reviewer"
                ? "Reviewer is checking evidence, fidelity, and platform fit."
                : event.stage === "repair"
                  ? "One bounded repair pass is addressing the reviewer’s exact findings."
                  : "Drafter is shaping the approved brief into native posts.",
            );
          }
          if (event.type === "draft_stage_completed") setStageSummary(event.summary);
          if (event.type === "draft_session_completed") {
            setSession(event.session);
            setSessions((current) => [
              event.session,
              ...current.filter((item) => item.id !== event.session.id),
            ]);
            setActivePlatform(event.session.requested_platforms[0]);
            setStage("complete");
            setStageSummary("The publication proof is ready for human review.");
          }
          if (event.type === "draft_session_failed") throw new Error(event.error);
        }
        if (done) break;
      }
    } catch (caught) {
      setError(friendlyError(caught));
      setStage("idle");
    } finally {
      setWorking(false);
    }
  }

  async function updateDraft(kind: "save" | "approve") {
    if (!session || !currentRevision || action) return;
    setAction(kind);
    setError("");
    try {
      const response = await fetch(`/api/drafts/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "save"
            ? { action: "save", platform: activePlatform, content: editorValue }
            : { action: "approve", platform: activePlatform },
        ),
      });
      const data = (await response.json()) as { session?: DraftSession; error?: string };
      if (!response.ok || !data.session) throw new Error(data.error ?? "The draft could not be updated.");
      setSession(data.session);
      setSessions((current) => current.map((item) => item.id === data.session?.id ? data.session : item));
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setAction(null);
    }
  }

  async function checkAgain() {
    if (!session || changed || action) return;
    setAction("review");
    setError("");
    try {
      const response = await fetch(`/api/drafts/${session.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: [activePlatform] }),
      });
      const data = (await response.json()) as { session?: DraftSession; error?: string };
      if (!response.ok || !data.session) throw new Error(data.error ?? "The reviewer could not finish.");
      setSession(data.session);
      setSessions((current) => current.map((item) => item.id === data.session?.id ? data.session : item));
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setAction(null);
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(editorValue);
      setCopied(true);
      setAction("copy");
      window.setTimeout(() => {
        setCopied(false);
        setAction(null);
      }, 1600);
    } catch {
      setError("The browser could not copy this draft. Select the text and copy it manually.");
    }
  }

  return (
    <section className={`draft-studio ${studioOpen ? "is-open" : ""}`} aria-label="Draft Studio">
      <button
        className="draft-studio-launch"
        type="button"
        onClick={toggleStudio}
        aria-expanded={studioOpen}
      >
        <span>
          <span className="eyebrow">Draft studio</span>
          <strong>Turn this brief into publication-ready base writing</strong>
          <small>Writer → adversarial review → one bounded repair, with you as publisher.</small>
        </span>
        <span className="draft-launch-action">{studioOpen ? "Close studio" : "Create a proof"} <b>↗</b></span>
      </button>

      {studioOpen && (
        <div className="draft-studio-body">
          <div className="draft-setup">
            <div className="draft-setup-heading">
              <div>
                <span className="draft-step">01 / Commission</span>
                <h3>Choose the publishing surface.</h3>
              </div>
              {sessions.length > 0 && (
                <label className="proof-history-select">
                  <span>Previous proofs</span>
                  <select
                    value={session?.id ?? ""}
                    onChange={(event) => {
                      const selected = sessions.find((item) => item.id === event.target.value);
                      if (selected) chooseSession(selected);
                    }}
                  >
                    {sessions.map((item, index) => (
                      <option value={item.id} key={item.id}>
                        {index === 0 ? "Latest" : `Proof ${sessions.length - index}`} · {new Date(item.created_at).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="platform-commission" role="group" aria-label="Publishing platforms">
              {(["LINKEDIN", "THREADS"] as const).map((platform) => (
                <button
                  type="button"
                  className={platforms.includes(platform) ? "is-selected" : ""}
                  aria-pressed={platforms.includes(platform)}
                  onClick={() => togglePlatform(platform)}
                  key={platform}
                  disabled={working}
                >
                  <span>{platformLabel(platform)}</span>
                  <small>{platform === "LINKEDIN" ? "Argument-led · 3,000 max" : "Conversational · 500 max"}</small>
                </button>
              ))}
            </div>

            <div className="draft-input-grid">
              <label>
                <span>Evidence desk <i>optional</i></span>
                <textarea
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                  placeholder={brief.evidence_needed.length > 0
                    ? `Useful before publication: ${brief.evidence_needed.join(" · ")}`
                    : "Add verified examples, facts, or project context. The writer will not invent them."}
                  maxLength={6000}
                  disabled={working}
                />
              </label>
              <label>
                <span>Writing direction <i>optional</i></span>
                <textarea
                  value={guidance}
                  onChange={(event) => setGuidance(event.target.value)}
                  placeholder="A sharper opening, a warmer tone, a point to emphasize…"
                  maxLength={2000}
                  disabled={working}
                />
              </label>
            </div>

            <div className="draft-command-row">
              <p>The brief is authoritative. Unsupported proof is narrowed, never fabricated.</p>
              <button type="button" onClick={() => void generateDrafts()} disabled={working}>
                {working ? "Preparing proof…" : session ? "Generate a new proof" : "Generate publication proof"}
                <span>↗</span>
              </button>
            </div>

            {(working || stage === "complete") && (
              <div className="draft-progress" aria-live="polite">
                <div className="draft-progress-line" style={{ "--draft-progress": `${(stageIndex / 3) * 100}%` } as React.CSSProperties}><span /></div>
                {(["Writer", "Reviewer", "Repair if needed"] as const).map((label, index) => (
                  <span className={index < stageIndex ? "is-reached" : ""} key={label}>{label}</span>
                ))}
                <p>{stageSummary}</p>
              </div>
            )}
            {loadingHistory && <p className="draft-studio-note">Checking for earlier proofs…</p>}
          </div>

          {session && currentRevision && (
            <div className="publication-proof">
              <header className="proof-header">
                <div>
                  <span className="draft-step">02 / Publication proof</span>
                  <h3>Make the final editorial decision.</h3>
                </div>
                <div className="proof-run-meta">
                  <span>{session.usage.total_tokens.toLocaleString()} tokens</span>
                  <span>{session.models.drafter?.split("/").at(-1) ?? "Writer"}</span>
                </div>
              </header>

              <div className="proof-platform-tabs" role="tablist" aria-label="Draft platforms">
                {session.drafts.map((draft) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activePlatform === draft.platform}
                    className={activePlatform === draft.platform ? "is-active" : ""}
                    onClick={() => setActivePlatform(draft.platform)}
                    key={draft.platform}
                  >
                    {platformLabel(draft.platform)}
                    <span className={`review-dot is-${draft.current.review_state.toLowerCase()}`} />
                  </button>
                ))}
              </div>

              <div className="proof-sheet">
                <div className="proof-copy-column">
                  <div className="proof-copy-meta">
                    <span>Revision {currentRevision.revision}</span>
                    <span>{currentRevision.source.toLowerCase()}</span>
                    {currentRevision.approved_at && <strong>Approved</strong>}
                  </div>
                  <textarea
                    className="proof-editor"
                    value={editorValue}
                    onChange={(event) => {
                      if (!currentRevision) return;
                      setEditorValues((current) => ({
                        ...current,
                        [currentRevision.id]: event.target.value,
                      }));
                    }}
                    aria-label={`${platformLabel(activePlatform)} draft`}
                    spellCheck
                  />
                  <div className={`proof-count ${overLimit ? "is-over" : ""}`}>
                    <span>{characterCount.toLocaleString()} / {platformLimit.toLocaleString()}</span>
                    <span>{overLimit ? `${(characterCount - platformLimit).toLocaleString()} over limit` : `${(platformLimit - characterCount).toLocaleString()} remaining`}</span>
                  </div>

                  <div className="proof-actions">
                    <button
                      type="button"
                      className="proof-action-primary"
                      onClick={() => void updateDraft("save")}
                      disabled={!changed || editorValue.trim().length < 40 || Boolean(action)}
                    >
                      {action === "save" ? "Saving…" : "Save revision"}
                    </button>
                    <button type="button" onClick={() => void checkAgain()} disabled={changed || Boolean(action)} title={changed ? "Save this revision before review." : undefined}>
                      {action === "review" ? "Reviewing…" : "Check again"}
                    </button>
                    <button type="button" onClick={() => void copyDraft()} disabled={!editorValue || action === "copy"}>
                      {copied ? "Copied" : "Copy post"}
                    </button>
                    <button
                      type="button"
                      className="approve-action"
                      onClick={() => void updateDraft("approve")}
                      disabled={changed || overLimit || Boolean(action) || Boolean(currentRevision.approved_at)}
                    >
                      {currentRevision.approved_at ? "Approved" : action === "approve" ? "Approving…" : "Approve proof"}
                    </button>
                  </div>
                </div>

                <aside className="review-margin" aria-label="Reviewer findings">
                  <div className="review-margin-heading">
                    <span>Proofreader’s margin</span>
                    <strong className={`review-verdict is-${currentRevision.review_state.toLowerCase()}`}>
                      {currentRevision.review_state.replaceAll("_", " ")}
                    </strong>
                  </div>
                  {currentRevision.review ? (
                    <>
                      <p className="review-summary">{currentRevision.review.summary}</p>
                      {currentRevision.review.findings.length > 0 ? (
                        <ol className="review-findings">
                          {currentRevision.review.findings.map((finding, index) => (
                            <li key={`${finding.category}-${index}`}>
                              <span>{finding.category.replaceAll("_", " ")}</span>
                              {finding.quote && <blockquote>“{finding.quote}”</blockquote>}
                              <p>{finding.message}</p>
                              <small>{finding.required_change}</small>
                            </li>
                          ))}
                        </ol>
                      ) : <p className="review-clear">No blocking findings. Read it once in your own voice before publishing.</p>}
                    </>
                  ) : (
                    <p className="review-summary">This revision has not been checked. Save it, then ask the Reviewer to inspect it.</p>
                  )}
                </aside>
              </div>

              <div className="revision-ledger">
                <span>Revision ledger</span>
                <ol>
                  {platformView?.revisions.map((revision) => (
                    <li className={revision.id === currentRevision.id ? "is-current" : ""} key={revision.id}>
                      <strong>R{revision.revision}</strong>
                      <span>{revision.source.toLowerCase()}</span>
                      <time>{new Date(revision.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                      {revision.approved_at && <b>approved</b>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {error && <div className="draft-error" role="alert"><strong>Draft Studio stopped.</strong> {error}</div>}
        </div>
      )}
    </section>
  );
}

import { describe, expect, it } from "vitest";
import type { DraftAgentName } from "@/config/agents";
import type {
  DraftPlatform,
  DraftRequest,
  DraftReviewState,
  DraftRevision,
  DraftSession,
  DraftSessionStatus,
  DraftSource,
  DraftSourceContext,
  PlatformReview,
} from "@/domain/drafts";
import type { Usage } from "@/domain/schemas";
import type { CompletionRequest, CompletionResult, LlmGateway } from "@/llm/gateway";
import type { DraftRepository } from "@/persistence/draft-types";
import type { AgentRunCompletion } from "@/persistence/types";
import { repairDraftRevision, reviewDraftSession, runDrafting } from "./orchestrator";

const source: DraftSourceContext = {
  run_id: "00000000-0000-4000-8000-000000000001",
  candidate_id: "00000000-0000-4000-8000-000000000002",
  source_type: "observation",
  signal: "AI coding makes implementation faster, but companies can still build the wrong thing.",
  signal_context: "Thinking about how AI changes software delivery.",
  brief: {
    candidate_id: "00000000-0000-4000-8000-000000000002",
    title: "When code gets cheaper, decisions get expensive",
    primary_job: "THINK",
    target_audience: ["CTOs", "product leaders"],
    core_claim: "Implementation speed increases the leverage of deciding what to build.",
    why_people_care: "Faster output does not guarantee better outcomes.",
    axelyn_right_to_speak: "Axelyn works between business requirements and production delivery.",
    reader_takeaway: "Improve decision quality alongside delivery speed.",
    counterargument: "Fast iteration can make wrong choices cheaper to correct.",
    evidence_needed: ["A verified delivery example"],
    linkedin_angle: "Explain the operational tradeoff with a practical framework.",
    threads_angle: "State the build-speed and decision-quality tension directly.",
    recommended_platform: "BOTH",
    strategic_reasoning: "Specific, useful, and defensible with restrained claims.",
    rank: 1,
    score: 84,
    status: "NEEDS_EVIDENCE",
  },
};

const usage: Usage = {
  prompt_tokens: 100,
  completion_tokens: 50,
  total_tokens: 150,
  reasoning_tokens: 5,
  cached_tokens: 0,
  cost: 0.002,
  estimated_cost: 0.002,
};

class MemoryDraftRepository implements DraftRepository {
  context = source;
  session: DraftSession | null = null;
  failed = false;

  async getBriefContext(): Promise<DraftSourceContext> { return this.context; }
  async createSession(
    id: string,
    context: DraftSourceContext,
    request: DraftRequest,
    models: Record<string, string>,
    createdBy: string | null,
  ) {
    this.context = context;
    this.session = {
      id,
      pipeline_run_id: context.run_id,
      candidate_id: context.candidate_id,
      requested_platforms: request.platforms,
      evidence: request.evidence,
      guidance: request.guidance,
      status: "RUNNING",
      models,
      usage: { ...usage, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reasoning_tokens: 0, cost: 0, estimated_cost: 0 },
      error: null,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      completed_at: null,
      drafts: [],
    };
  }
  async startAgentRun(_sessionId: string, agent: DraftAgentName): Promise<string> { return `${agent}-${Math.random()}`; }
  async completeAgentRun(agentRunId: string, completion: AgentRunCompletion) {
    void [agentRunId, completion];
  }
  async failAgentRun(agentRunId: string, error: string, durationMs: number) {
    void [agentRunId, error, durationMs];
  }
  async saveRevision(
    sessionId: string,
    platform: DraftPlatform,
    revision: number,
    revisionSource: DraftSource,
    content: string,
    state: DraftReviewState,
    review: PlatformReview | null,
    createdBy: string | null,
  ) {
    if (!this.session) throw new Error("Missing session");
    const item: DraftRevision = {
      id: `${platform}-${revision}`,
      session_id: sessionId,
      platform,
      revision,
      source: revisionSource,
      content,
      character_count: Array.from(content).length,
      review_state: state,
      review,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      approved_by: null,
      approved_at: null,
      buffer_deliveries: [],
    };
    const view = this.session.drafts.find((draft) => draft.platform === platform);
    if (view) {
      view.revisions.push(item);
      view.current = item;
    } else {
      this.session.drafts.push({ platform, current: item, revisions: [item] });
    }
  }
  async applyReview(
    _sessionId: string,
    platform: DraftPlatform,
    revision: number,
    state: DraftReviewState,
    review: PlatformReview,
  ) {
    const item = this.session?.drafts.find((draft) => draft.platform === platform)
      ?.revisions.find((candidate) => candidate.revision === revision);
    if (!item) throw new Error("Missing revision");
    item.review_state = state;
    item.review = review;
  }
  async finishSession(
    _sessionId: string,
    status: Exclude<DraftSessionStatus, "RUNNING" | "FAILED">,
    totals: Usage,
    models: Record<string, string>,
  ) {
    if (!this.session) throw new Error("Missing session");
    this.session.status = status;
    this.session.usage = totals;
    this.session.models = models;
    this.session.completed_at = new Date().toISOString();
  }
  async failSession(_sessionId: string, error: string) {
    this.failed = true;
    if (this.session) {
      this.session.status = "FAILED";
      this.session.error = error;
    }
  }
  async updateSessionStatus(_sessionId: string, status: DraftSessionStatus) {
    if (this.session) this.session.status = status;
  }
  async getSession(): Promise<DraftSession | null> { return this.session; }
  async listSessions(): Promise<DraftSession[]> { return this.session ? [this.session] : []; }
  async getSessionContext(): Promise<DraftSourceContext> { return this.context; }
  async saveOperatorRevision(): Promise<DraftSession | null> { return this.session; }
  async saveRepairRevision(
    sessionId: string,
    platform: DraftPlatform,
    content: string,
    createdBy: string | null,
  ): Promise<DraftSession | null> {
    const revisions = this.session?.drafts.find((draft) => draft.platform === platform)?.revisions ?? [];
    const nextRevision = Math.max(0, ...revisions.map((revision) => revision.revision)) + 1;
    await this.saveRevision(
      sessionId,
      platform,
      nextRevision,
      "REPAIR",
      content,
      "UNCHECKED",
      null,
      createdBy,
    );
    return this.session;
  }
  async approveCurrentRevision(): Promise<DraftSession | null> { return this.session; }
}

type ReviewMode = "PASS" | "REVISE" | "NEEDS_INPUT";

class DraftFixtureGateway implements LlmGateway {
  calls: string[] = [];

  constructor(
    private readonly verdict: ReviewMode,
    private readonly returnUnexpectedPlatform = false,
  ) {}

  async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
    this.calls.push(request.schemaName);
    const platforms = [...request.user.matchAll(/"(LINKEDIN|THREADS)"/g)]
      .map((match) => match[1] as DraftPlatform)
      .filter((value, index, values) => values.indexOf(value) === index);
    let data: unknown;

    if (request.schemaName === "social_drafts") {
      const requested = this.returnUnexpectedPlatform ? ["THREADS"] : platforms;
      data = {
        drafts: requested.map((platform) => ({
          platform,
          content: platform === "LINKEDIN"
            ? "AI makes code cheaper. That raises the value of choosing the right problem before implementation begins. Faster delivery compounds good decisions and bad ones alike."
            : "AI makes code cheaper. That raises the value of choosing the right problem. Faster delivery compounds good decisions—and bad ones.",
        })),
      };
    } else if (request.schemaName === "social_draft_reviews") {
      data = {
        reviews: platforms.map((platform) => ({
          platform,
          verdict: this.verdict,
          summary: this.verdict === "PASS" ? "Ready for human review." : "The opening needs a more specific tradeoff.",
          findings: this.verdict === "PASS" ? [] : [{
            category: this.verdict === "NEEDS_INPUT" ? "EVIDENCE" : "GENERICNESS",
            quote: "AI makes code cheaper.",
            message: this.verdict === "NEEDS_INPUT" ? "The claim needs operator evidence." : "The opening is too broad.",
            required_change: this.verdict === "NEEDS_INPUT" ? "Supply a verified example." : "Tie the opening to decision quality.",
          }],
        })),
      };
    } else {
      data = {
        drafts: platforms.map((platform) => ({
          platform,
          content: platform === "LINKEDIN"
            ? "Cheaper code does not make product judgment cheaper. When implementation accelerates, choosing the right problem carries more leverage. The teams that benefit will shorten discovery and validation alongside delivery."
            : "Cheaper code does not make product judgment cheaper. As implementation accelerates, choosing the right problem carries more leverage.",
        })),
      };
    }

    return {
      data: request.schema.parse(data),
      model: request.config.model,
      provider: "fixture",
      generationId: `fixture-${request.schemaName}`,
      usage,
    };
  }
}

describe("runDrafting", () => {
  it("writes and reviews both platforms without a repair when they pass", async () => {
    const gateway = new DraftFixtureGateway("PASS");
    const repository = new MemoryDraftRepository();
    const result = await runDrafting(source, {
      platforms: ["LINKEDIN", "THREADS"], evidence: "", guidance: "",
    }, "editor@example.com", { gateway, repository });

    expect(gateway.calls).toEqual(["social_drafts", "social_draft_reviews"]);
    expect(result.status).toBe("READY_FOR_REVIEW");
    expect(result.drafts.map((draft) => draft.platform)).toEqual(["LINKEDIN", "THREADS"]);
    expect(result.drafts.every((draft) => draft.current.review_state === "PASS")).toBe(true);
    expect(result.usage.total_tokens).toBe(300);
  });

  it("uses exactly one repair pass for repairable findings", async () => {
    const gateway = new DraftFixtureGateway("REVISE");
    const repository = new MemoryDraftRepository();
    const result = await runDrafting(source, {
      platforms: ["THREADS"], evidence: "", guidance: "",
    }, null, { gateway, repository });

    expect(gateway.calls).toEqual([
      "social_drafts", "social_draft_reviews", "social_draft_repairs",
    ]);
    expect(result.drafts[0].revisions).toHaveLength(2);
    expect(result.drafts[0].current.source).toBe("REPAIR");
    expect(result.drafts[0].current.review_state).toBe("REPAIRED");
    expect(result.usage.total_tokens).toBe(450);
  });

  it("stops for missing operator evidence instead of fabricating a repair", async () => {
    const gateway = new DraftFixtureGateway("NEEDS_INPUT");
    const repository = new MemoryDraftRepository();
    const result = await runDrafting(source, {
      platforms: ["LINKEDIN"], evidence: "", guidance: "",
    }, null, { gateway, repository });

    expect(gateway.calls).toEqual(["social_drafts", "social_draft_reviews"]);
    expect(result.status).toBe("NEEDS_INPUT");
    expect(result.drafts[0].current.review_state).toBe("NEEDS_INPUT");
  });

  it("rejects a model response that does not match the requested platforms", async () => {
    const gateway = new DraftFixtureGateway("PASS", true);
    const repository = new MemoryDraftRepository();

    await expect(runDrafting(source, {
      platforms: ["LINKEDIN"], evidence: "", guidance: "",
    }, null, { gateway, repository })).rejects.toThrow("exactly one result");
    expect(repository.failed).toBe(true);
    expect(gateway.calls).toHaveLength(1);
  });

  it("re-checks a saved current revision without starting another writer pass", async () => {
    const repository = new MemoryDraftRepository();
    await runDrafting(source, {
      platforms: ["THREADS"], evidence: "", guidance: "",
    }, null, { gateway: new DraftFixtureGateway("REVISE"), repository });
    const reviewer = new DraftFixtureGateway("PASS");
    const sessionId = repository.session?.id;
    if (!sessionId) throw new Error("Expected a drafting session.");

    const result = await reviewDraftSession(sessionId, ["THREADS"], {
      gateway: reviewer,
      repository,
    });

    expect(reviewer.calls).toEqual(["social_draft_reviews"]);
    expect(result.drafts[0].current.review_state).toBe("PASS");
    expect(result.usage.total_tokens).toBe(600);
  });

  it("repairs any selected revision into a new unreviewed revision", async () => {
    const repository = new MemoryDraftRepository();
    await runDrafting(source, {
      platforms: ["LINKEDIN"], evidence: "", guidance: "",
    }, null, { gateway: new DraftFixtureGateway("REVISE"), repository });
    const repairer = new DraftFixtureGateway("PASS");
    const sessionId = repository.session?.id;
    if (!sessionId) throw new Error("Expected a drafting session.");

    const result = await repairDraftRevision(sessionId, {
      platform: "LINKEDIN",
      revision: 1,
      instructions: "Make the opening more direct and soften the final claim.",
    }, "editor@example.com", { gateway: repairer, repository });

    expect(repairer.calls).toEqual(["social_draft_operator_repair"]);
    expect(result.drafts[0].revisions).toHaveLength(3);
    expect(result.drafts[0].current).toMatchObject({
      revision: 3,
      source: "REPAIR",
      review_state: "UNCHECKED",
      created_by: "editor@example.com",
    });
    expect(result.usage.total_tokens).toBe(600);
  });
});

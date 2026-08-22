import { describe, expect, it } from "vitest";
import type { AgentName } from "@/config/agents";
import type {
  Candidate,
  CriticEvaluation,
  FinalBrief,
  ScoutOutput,
  SignalInput,
  StrategistEvaluation,
  Usage,
} from "@/domain/schemas";
import type { CompletionRequest, CompletionResult, LlmGateway } from "@/llm/gateway";
import type { AgentRunCompletion, PipelineRepository, RecentRun, StoredRun } from "@/persistence/types";
import { runPipeline } from "./orchestrator";

const usage: Usage = {
  prompt_tokens: 100,
  completion_tokens: 50,
  total_tokens: 150,
  reasoning_tokens: 0,
  cached_tokens: 0,
  cost: 0.001,
  estimated_cost: 0.001,
};

class MemoryRepository implements PipelineRepository {
  candidates: Candidate[] = [];
  critiques: CriticEvaluation[] = [];
  strategies: StrategistEvaluation[] = [];
  briefs: FinalBrief[] = [];

  async createRun(id: string, input: SignalInput, models: Record<string, string>) { void [id, input, models]; }
  async startAgentRun(runId: string, agent: AgentName): Promise<string> { void runId; return `${agent}-run`; }
  async completeAgentRun(agentRunId: string, completion: AgentRunCompletion) { void [agentRunId, completion]; }
  async failAgentRun(agentRunId: string, error: string, durationMs: number) { void [agentRunId, error, durationMs]; }
  async saveScout(runId: string, output: ScoutOutput) { void [runId, output]; }
  async saveCandidates(runId: string, candidates: Candidate[]) { void runId; this.candidates = candidates; }
  async saveCritiques(runId: string, critiques: CriticEvaluation[]) { void runId; this.critiques = critiques; }
  async saveStrategies(runId: string, strategies: StrategistEvaluation[]) { void runId; this.strategies = strategies; }
  async saveBriefs(runId: string, briefs: FinalBrief[]) { void runId; this.briefs = briefs; }
  async finishRun(runId: string, status: "COMPLETED" | "STOPPED", totals: Usage, models: Record<string, string>) { void [runId, status, totals, models]; }
  async failRun(runId: string, error: string) { void [runId, error]; }
  async listRuns(limit?: number): Promise<RecentRun[]> { void limit; return []; }
  async getRun(id: string): Promise<StoredRun | null> { void id; return null; }
}

class FixtureGateway implements LlmGateway {
  calls: string[] = [];

  async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
    this.calls.push(request.schemaName);
    let data: unknown;

    if (request.schemaName === "scout_output") {
      data = {
        signal: "AI reduces implementation time without ensuring useful decisions.",
        happened: "AI-assisted coding accelerated implementation.",
        change: "Code production is less of a constraint.",
        why_it_matters: "Teams can reach the wrong outcome faster.",
        tension: "Delivery speed is rising faster than decision quality.",
        audiences: ["founders", "CTOs", "engineers"],
        business_implications: ["Discovery and prioritization become more valuable."],
        questions: ["What becomes the new bottleneck?"],
        quality: { relevance: 90, business_relevance: 88, idea_potential: 86 },
        continue_pipeline: true,
        stop_reason: "",
      };
    } else if (request.schemaName === "explorer_output") {
      data = {
        selected_taxonomies: ["THINK"],
        taxonomy_rationale: [{ taxonomy: "THINK", reason: "The signal reframes the delivery bottleneck." }],
        candidates: [
          {
            taxonomy: "THINK",
            core_idea: "Decision quality becomes more valuable as code becomes cheaper.",
            tension: "Faster delivery can amplify a bad choice.",
            intended_audience: ["founders", "CTOs"],
            reader_payoff: "Reframes AI coding as a decision problem.",
            why_interesting: "It relocates the engineering bottleneck.",
            axelyn_connection: "Requirements-to-production experience.",
          },
          {
            taxonomy: "THINK",
            core_idea: "AI will change everything.",
            tension: "Change is fast.",
            intended_audience: ["everyone"],
            reader_payoff: "A broad warning.",
            why_interesting: "AI is popular.",
            axelyn_connection: "Axelyn uses technology.",
          },
          {
            taxonomy: "THINK",
            core_idea: "Shorter build cycles need shorter validation loops.",
            tension: "Feedback can remain slow while coding accelerates.",
            intended_audience: ["product leaders"],
            reader_payoff: "Connects engineering speed to validation practice.",
            why_interesting: "The two loops do not automatically accelerate together.",
            axelyn_connection: "Delivery and product translation experience.",
          },
        ],
      };
    } else if (request.schemaName === "critic_output") {
      const ids = [...request.user.matchAll(/"id": "([^"]+)"/g)].map((match) => match[1]);
      data = {
        evaluations: ids.map((id, index) => ({
          candidate_id: id,
          originality: index === 1 ? 5 : 78,
          credibility: index === 1 ? 15 : 85,
          audience_relevance: index === 1 ? 20 : 82,
          genericness: index === 1 ? 100 : 15,
          strategic_risk: index === 1 ? 88 : 12,
          hype: index === 1 ? 95 : 3,
          claim_defensible: index !== 1,
          meaningful_counterargument: "Faster iteration may also make mistakes cheaper to reverse.",
          evidence_requirement: "LIGHT",
          evidence_needed: ["A concrete delivery example"],
          risks: index === 1 ? ["Empty universal claim"] : [],
          recommendation: index === 1 ? "KILL" : index === 2 ? "REWORK" : "KEEP",
          reasoning: index === 1 ? "Fails the 500-creators test." : "Specific and credible enough to develop.",
        })),
      };
    } else {
      const ids = [...new Set([...request.user.matchAll(/"id": "([^"]+)"/g)].map((match) => match[1]))];
      data = {
        evaluations: ids.map((id, index) => ({
          candidate_id: id,
          title: index === 0 ? "When code gets cheaper, decisions get expensive" : "Your validation loop is now the bottleneck",
          primary_job: "THINK",
          target_audience: index === 0 ? ["founders", "CTOs"] : ["product leaders"],
          core_claim: index === 0
            ? "Implementation speed increases the leverage of deciding what to build."
            : "Build speed only compounds value when validation speeds up too.",
          why_people_care: "Faster output does not guarantee better outcomes.",
          axelyn_right_to_speak: "Axelyn works between business requirements and production delivery.",
          reader_takeaway: "Invest in decision and validation quality alongside coding tools.",
          counterargument: "Fast iteration can make wrong choices cheaper to correct.",
          evidence_needed: ["A suitably anonymized project example"],
          linkedin_angle: "Explain the operational tradeoff with a practical framework.",
          threads_angle: "Use a compact sequence contrasting build and feedback loops.",
          recommended_platform: "BOTH",
          readiness_status: "NEEDS_EVIDENCE",
          component_scores: {
            strategic_fit: 88 - index * 5,
            audience_relevance: 86,
            credibility: 84,
            conversation_potential: 80,
            originality: 78,
            memorability: 82,
          },
          penalties: {
            genericness: 10 + index * 5,
            hype: 0,
            weak_evidence: 12,
            repetition: 0,
            weak_axelyn_connection: 5,
          },
          strategic_reasoning: "A credible, relevant idea with a specific evidence need.",
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

describe("runPipeline", () => {
  it("runs the bounded stages, removes KILLs, and ranks only survivors", async () => {
    const gateway = new FixtureGateway();
    const repository = new MemoryRepository();
    const result = await runPipeline({
      source_type: "observation",
      content: "AI coding makes implementation much faster, but companies can still build the wrong thing.",
      context: "Thinking about how AI changes software engineering.",
    }, { gateway, repository });

    const killedId = repository.critiques.find((critique) => critique.recommendation === "KILL")?.candidate_id;
    expect(gateway.calls).toEqual(["scout_output", "explorer_output", "critic_output", "strategist_output"]);
    expect(result.status).toBe("COMPLETED");
    expect(result.briefs).toHaveLength(2);
    expect(result.briefs.map((brief) => brief.candidate_id)).not.toContain(killedId);
    expect(result.briefs[0].score).toBeGreaterThanOrEqual(result.briefs[1].score);
    expect(result.usage.total_tokens).toBe(600);
    expect(repository.briefs).toEqual(result.briefs);
  });
});

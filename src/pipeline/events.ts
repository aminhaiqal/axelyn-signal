import type { AgentName } from "@/config/agents";
import type { PipelineResult } from "@/domain/schemas";

export type PipelineEvent =
  | { type: "run_started"; run_id: string; models: Record<string, string> }
  | { type: "stage_started"; run_id: string; stage: AgentName }
  | { type: "stage_completed"; run_id: string; stage: AgentName; summary: string }
  | { type: "pipeline_completed"; run_id: string; result: PipelineResult }
  | { type: "pipeline_failed"; run_id: string; error: string };

export type PipelineEventHandler = (event: PipelineEvent) => void | Promise<void>;

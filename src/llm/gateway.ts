import type { z } from "zod";
import type { AgentConfig } from "@/config/agents";
import type { Usage } from "@/domain/schemas";

export class InvalidStructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStructuredOutputError";
  }
}

export interface CompletionRequest<T> {
  system: string;
  user: string;
  schemaName: string;
  schema: z.ZodType<T>;
  config: AgentConfig;
}

export interface CompletionResult<T> {
  data: T;
  model: string;
  provider: string | null;
  generationId: string | null;
  usage: Usage;
}

export interface LlmGateway {
  complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>>;
}

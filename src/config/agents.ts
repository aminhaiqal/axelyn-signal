export type AgentName = "scout" | "explorer" | "critic" | "strategist";
export type DraftAgentName = "drafter" | "reviewer";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "max";
export type ModelVerbosity = "low" | "medium" | "high";

export interface AgentConfig {
  model: string;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  verbosity?: ModelVerbosity;
  requireStructuredOutputProvider?: boolean;
  maxOutputTokens: number;
  inputPricePerToken: number;
  outputPricePerToken: number;
}

function numericSetting(name: string, fallback: number, min = 0, max = Number.POSITIVE_INFINITY): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function enumSetting<T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
  const value = process.env[name] as T | undefined;
  return value && allowed.includes(value) ? value : fallback;
}

export function getAgentConfig(): Record<AgentName, AgentConfig> {
  return {
    scout: {
      model: process.env.SCOUT_MODEL ?? "google/gemini-2.5-flash-lite",
      temperature: numericSetting("SCOUT_TEMPERATURE", 0.2, 0, 2),
      requireStructuredOutputProvider: true,
      maxOutputTokens: numericSetting("SCOUT_MAX_OUTPUT_TOKENS", 1600, 256, 20000),
      inputPricePerToken: numericSetting("SCOUT_INPUT_PRICE", 0.0000001),
      outputPricePerToken: numericSetting("SCOUT_OUTPUT_PRICE", 0.0000004),
    },
    explorer: {
      model: process.env.EXPLORER_MODEL ?? "google/gemini-2.5-flash",
      temperature: numericSetting("EXPLORER_TEMPERATURE", 0.75, 0, 2),
      requireStructuredOutputProvider: true,
      maxOutputTokens: numericSetting("EXPLORER_MAX_OUTPUT_TOKENS", 5200, 256, 20000),
      inputPricePerToken: numericSetting("EXPLORER_INPUT_PRICE", 0.0000003),
      outputPricePerToken: numericSetting("EXPLORER_OUTPUT_PRICE", 0.0000025),
    },
    critic: {
      model: process.env.CRITIC_MODEL ?? "deepseek/deepseek-v3.2",
      temperature: numericSetting("CRITIC_TEMPERATURE", 0.25, 0, 2),
      requireStructuredOutputProvider: true,
      maxOutputTokens: numericSetting("CRITIC_MAX_OUTPUT_TOKENS", 5200, 256, 20000),
      inputPricePerToken: numericSetting("CRITIC_INPUT_PRICE", 0.000000269),
      outputPricePerToken: numericSetting("CRITIC_OUTPUT_PRICE", 0.0000004),
    },
    strategist: {
      model: process.env.STRATEGIST_MODEL ?? "anthropic/claude-haiku-4.5",
      temperature: numericSetting("STRATEGIST_TEMPERATURE", 0.3, 0, 2),
      requireStructuredOutputProvider: true,
      maxOutputTokens: numericSetting("STRATEGIST_MAX_OUTPUT_TOKENS", 6200, 256, 20000),
      inputPricePerToken: numericSetting("STRATEGIST_INPUT_PRICE", 0.000001),
      outputPricePerToken: numericSetting("STRATEGIST_OUTPUT_PRICE", 0.000005),
    },
  };
}

export function getDraftAgentConfig(): Record<DraftAgentName, AgentConfig> {
  const reasoningEfforts = ["none", "low", "medium", "high", "max"] as const;
  const verbosityLevels = ["low", "medium", "high"] as const;
  return {
    drafter: {
      model: process.env.DRAFTER_MODEL ?? "anthropic/claude-sonnet-5",
      reasoningEffort: enumSetting("DRAFTER_REASONING_EFFORT", "low", reasoningEfforts),
      verbosity: enumSetting("DRAFTER_VERBOSITY", "medium", verbosityLevels),
      maxOutputTokens: numericSetting("DRAFTER_MAX_OUTPUT_TOKENS", 3500, 256, 20000),
      inputPricePerToken: numericSetting("DRAFTER_INPUT_PRICE", 0.000002),
      outputPricePerToken: numericSetting("DRAFTER_OUTPUT_PRICE", 0.00001),
    },
    reviewer: {
      model: process.env.DRAFT_REVIEWER_MODEL ?? "openai/gpt-5.6-terra",
      reasoningEffort: enumSetting("DRAFT_REVIEWER_REASONING_EFFORT", "medium", reasoningEfforts),
      verbosity: enumSetting("DRAFT_REVIEWER_VERBOSITY", "low", verbosityLevels),
      maxOutputTokens: numericSetting("DRAFT_REVIEWER_MAX_OUTPUT_TOKENS", 2200, 256, 20000),
      inputPricePerToken: numericSetting("DRAFT_REVIEWER_INPUT_PRICE", 0.000002),
      outputPricePerToken: numericSetting("DRAFT_REVIEWER_OUTPUT_PRICE", 0.000012),
    },
  };
}

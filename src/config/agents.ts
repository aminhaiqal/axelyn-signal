export type AgentName = "scout" | "explorer" | "critic" | "strategist";

export interface AgentConfig {
  model: string;
  temperature: number;
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

export function getAgentConfig(): Record<AgentName, AgentConfig> {
  return {
    scout: {
      model: process.env.SCOUT_MODEL ?? "google/gemini-2.5-flash-lite",
      temperature: numericSetting("SCOUT_TEMPERATURE", 0.2, 0, 2),
      maxOutputTokens: numericSetting("SCOUT_MAX_OUTPUT_TOKENS", 1600, 256, 20000),
      inputPricePerToken: numericSetting("SCOUT_INPUT_PRICE", 0.0000001),
      outputPricePerToken: numericSetting("SCOUT_OUTPUT_PRICE", 0.0000004),
    },
    explorer: {
      model: process.env.EXPLORER_MODEL ?? "google/gemini-2.5-flash",
      temperature: numericSetting("EXPLORER_TEMPERATURE", 0.75, 0, 2),
      maxOutputTokens: numericSetting("EXPLORER_MAX_OUTPUT_TOKENS", 5200, 256, 20000),
      inputPricePerToken: numericSetting("EXPLORER_INPUT_PRICE", 0.0000003),
      outputPricePerToken: numericSetting("EXPLORER_OUTPUT_PRICE", 0.0000025),
    },
    critic: {
      model: process.env.CRITIC_MODEL ?? "deepseek/deepseek-v3.2",
      temperature: numericSetting("CRITIC_TEMPERATURE", 0.25, 0, 2),
      maxOutputTokens: numericSetting("CRITIC_MAX_OUTPUT_TOKENS", 5200, 256, 20000),
      inputPricePerToken: numericSetting("CRITIC_INPUT_PRICE", 0.000000269),
      outputPricePerToken: numericSetting("CRITIC_OUTPUT_PRICE", 0.0000004),
    },
    strategist: {
      model: process.env.STRATEGIST_MODEL ?? "anthropic/claude-haiku-4.5",
      temperature: numericSetting("STRATEGIST_TEMPERATURE", 0.3, 0, 2),
      maxOutputTokens: numericSetting("STRATEGIST_MAX_OUTPUT_TOKENS", 6200, 256, 20000),
      inputPricePerToken: numericSetting("STRATEGIST_INPUT_PRICE", 0.000001),
      outputPricePerToken: numericSetting("STRATEGIST_OUTPUT_PRICE", 0.000005),
    },
  };
}

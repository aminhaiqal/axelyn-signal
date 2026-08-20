import { getAgentConfig } from "@/config/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const models = Object.fromEntries(
    Object.entries(getAgentConfig()).map(([agent, config]) => [agent, config.model]),
  );
  return Response.json({
    openrouter_configured: Boolean(process.env.OPENROUTER_API_KEY),
    models,
  });
}

import { getAgentConfig } from "@/config/agents";
import { OpenRouterKeyStore } from "@/security/openrouter-key-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(data: unknown): Response {
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const models = Object.fromEntries(
    Object.entries(getAgentConfig()).map(([agent, config]) => [agent, config.model]),
  );
  try {
    const openrouter = await new OpenRouterKeyStore().status();
    return response({
      openrouter_configured: openrouter.configured && openrouter.encryption_ready,
      openrouter,
      models,
      operator_email: request.headers.get("cf-access-authenticated-user-email"),
    });
  } catch {
    return response({
      openrouter_configured: false,
      openrouter: null,
      models,
      operator_email: request.headers.get("cf-access-authenticated-user-email"),
    });
  }
}

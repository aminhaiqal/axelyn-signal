import { getAgentConfig, getDraftAgentConfig } from "@/config/agents";
import { OpenRouterKeyStore } from "@/security/openrouter-key-store";
import { BufferKeyStore } from "@/security/buffer-key-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(data: unknown): Response {
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const models = Object.fromEntries(
    Object.entries({ ...getAgentConfig(), ...getDraftAgentConfig() })
      .map(([agent, config]) => [agent, config.model]),
  );
  try {
    const [openrouter, buffer] = await Promise.all([
      new OpenRouterKeyStore().status(),
      new BufferKeyStore().status(),
    ]);
    return response({
      openrouter_configured: openrouter.configured && openrouter.encryption_ready,
      openrouter,
      buffer_configured: buffer.configured && buffer.encryption_ready,
      buffer,
      models,
      operator_email: request.headers.get("cf-access-authenticated-user-email"),
    });
  } catch {
    return response({
      openrouter_configured: false,
      openrouter: null,
      buffer_configured: false,
      buffer: null,
      models,
      operator_email: request.headers.get("cf-access-authenticated-user-email"),
    });
  }
}

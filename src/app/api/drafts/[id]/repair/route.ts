import { z } from "zod";
import { DraftRepairRequestSchema } from "@/domain/drafts";
import { repairDraftRevision } from "@/drafting/orchestrator";
import { OpenRouterGateway } from "@/llm/openrouter";
import { PostgresDraftRepository } from "@/persistence/postgres-draft-repository";
import { OpenRouterKeyStore } from "@/security/openrouter-key-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function response(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return response({ error: "Drafting session not found." }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = DraftRepairRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return response(
      { error: parsed.error.issues[0]?.message ?? "The repair request is invalid." },
      { status: 400 },
    );
  }

  let apiKey: string | null;
  try {
    apiKey = await new OpenRouterKeyStore().getApiKey();
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenRouter settings are unavailable.";
    return response({ error: message }, { status: 503 });
  }
  if (!apiKey) {
    return response(
      { error: "Add an OpenRouter API key in Settings before repairing." },
      { status: 409 },
    );
  }

  try {
    const operator = request.headers.get("cf-access-authenticated-user-email");
    const session = await repairDraftRevision(id, parsed.data, operator, {
      gateway: new OpenRouterGateway(apiKey),
      repository: new PostgresDraftRepository(),
    });
    return response({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The draft repair failed.";
    const status = message.includes("not found") ? 404 : 502;
    return response({ error: message }, { status });
  }
}

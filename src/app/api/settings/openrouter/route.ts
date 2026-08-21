import { z } from "zod";
import {
  OpenRouterApiKeySchema,
  OpenRouterKeyStore,
} from "@/security/openrouter-key-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

export async function GET(): Promise<Response> {
  try {
    return response({ openrouter: await new OpenRouterKeyStore().status() });
  } catch {
    return response({ error: "OpenRouter settings could not be loaded." }, { status: 503 });
  }
}

export async function PUT(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = z.object({ api_key: OpenRouterApiKeySchema }).safeParse(payload);
  if (!parsed.success) {
    return response({ error: parsed.error.issues[0]?.message ?? "The API key is invalid." }, { status: 400 });
  }

  try {
    const status = await new OpenRouterKeyStore().saveApiKey(parsed.data.api_key);
    return response({ openrouter: status });
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("SETTINGS_ENCRYPTION_KEY")
      ? error.message
      : "The API key could not be saved.";
    return response({ error: message }, { status: 503 });
  }
}

export async function DELETE(): Promise<Response> {
  try {
    return response({ openrouter: await new OpenRouterKeyStore().deleteApiKey() });
  } catch {
    return response({ error: "The API key could not be removed." }, { status: 503 });
  }
}

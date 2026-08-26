import { z } from "zod";
import { BufferGraphqlClient } from "@/integrations/buffer/client";
import { BufferApiKeySchema, BufferKeyStore } from "@/security/buffer-key-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

export async function GET(): Promise<Response> {
  const store = new BufferKeyStore();
  try {
    const buffer = await store.status();
    if (!buffer.configured || !buffer.encryption_ready) {
      return response({ buffer, channels: [] });
    }
    const apiKey = await store.getApiKey();
    if (!apiKey) return response({ buffer, channels: [] });
    try {
      const channels = await new BufferGraphqlClient(apiKey).listChannels();
      return response({ buffer, channels });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Buffer channels could not be loaded.";
      return response({ buffer, channels: [], connection_error: message });
    }
  } catch {
    return response({ error: "Buffer settings could not be loaded." }, { status: 503 });
  }
}

export async function PUT(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = z.object({ api_key: BufferApiKeySchema }).safeParse(payload);
  if (!parsed.success) {
    return response(
      { error: parsed.error.issues[0]?.message ?? "The Buffer API key is invalid." },
      { status: 400 },
    );
  }

  try {
    const channels = await new BufferGraphqlClient(parsed.data.api_key).listChannels();
    const buffer = await new BufferKeyStore().saveApiKey(parsed.data.api_key);
    return response({ buffer, channels });
  } catch (error) {
    const message = error instanceof Error && (
      error.message.startsWith("SETTINGS_ENCRYPTION_KEY") ||
      error.message.startsWith("Buffer ")
    )
      ? error.message
      : "The Buffer connection could not be verified.";
    return response({ error: message }, { status: 502 });
  }
}

export async function DELETE(): Promise<Response> {
  try {
    const buffer = await new BufferKeyStore().deleteApiKey();
    return response({ buffer, channels: [] });
  } catch {
    return response({ error: "The Buffer API key could not be removed." }, { status: 503 });
  }
}

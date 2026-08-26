import { z } from "zod";
import { BufferExportRequestSchema } from "@/domain/buffer";
import { BufferGraphqlClient } from "@/integrations/buffer/client";
import {
  BufferExportValidationError,
  exportApprovedDraftToBuffer,
} from "@/integrations/buffer/export";
import {
  BufferDeliveryConflictError,
  BufferDeliveryValidationError,
  PostgresBufferDeliveryRepository,
} from "@/persistence/postgres-buffer-repository";
import { PostgresDraftRepository } from "@/persistence/postgres-draft-repository";
import { BufferKeyStore } from "@/security/buffer-key-store";

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
  const parsed = BufferExportRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return response(
      { error: parsed.error.issues[0]?.message ?? "The Buffer handoff is invalid." },
      { status: 400 },
    );
  }

  let apiKey: string | null;
  try {
    apiKey = await new BufferKeyStore().getApiKey();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Buffer settings are unavailable.";
    return response({ error: message }, { status: 503 });
  }
  if (!apiKey) {
    return response(
      { error: "Connect Buffer in Settings before sending an approved proof." },
      { status: 409 },
    );
  }

  try {
    const delivery = await exportApprovedDraftToBuffer(
      id,
      parsed.data,
      request.headers.get("cf-access-authenticated-user-email"),
      {
        gateway: new BufferGraphqlClient(apiKey),
        repository: new PostgresBufferDeliveryRepository(),
      },
    );
    const session = await new PostgresDraftRepository().getSession(id);
    if (!session) return response({ error: "Drafting session not found." }, { status: 404 });
    return response({ delivery, session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Buffer handoff failed.";
    if (message === "Drafting session not found.") {
      return response({ error: message }, { status: 404 });
    }
    if (
      error instanceof BufferExportValidationError ||
      error instanceof BufferDeliveryValidationError ||
      error instanceof BufferDeliveryConflictError
    ) {
      return response({ error: message }, { status: 409 });
    }
    return response({ error: message }, { status: 502 });
  }
}

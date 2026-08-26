import { z } from "zod";
import { DraftRequestSchema } from "@/domain/drafts";
import { OpenRouterGateway } from "@/llm/openrouter";
import { PostgresDraftRepository } from "@/persistence/postgres-draft-repository";
import { runDrafting } from "@/drafting/orchestrator";
import { OpenRouterKeyStore } from "@/security/openrouter-key-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; candidateId: string }>;
}

const RouteParamsSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
});

function response(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const parsedParams = RouteParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) return response({ error: "Brief not found." }, { status: 404 });

  try {
    const repository = new PostgresDraftRepository();
    const source = await repository.getBriefContext(
      parsedParams.data.id,
      parsedParams.data.candidateId,
    );
    if (!source) return response({ error: "Brief not found." }, { status: 404 });
    const sessions = await repository.listSessions(
      parsedParams.data.id,
      parsedParams.data.candidateId,
    );
    return response({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Draft sessions could not be loaded.";
    return response({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const parsedParams = RouteParamsSchema.safeParse(await context.params);
  if (!parsedParams.success) return response({ error: "Brief not found." }, { status: 404 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsedRequest = DraftRequestSchema.safeParse(payload);
  if (!parsedRequest.success) {
    return response(
      { error: parsedRequest.error.issues[0]?.message ?? "The drafting request is invalid." },
      { status: 400 },
    );
  }

  const repository = new PostgresDraftRepository();
  let source;
  try {
    source = await repository.getBriefContext(
      parsedParams.data.id,
      parsedParams.data.candidateId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The brief could not be loaded.";
    return response({ error: message }, { status: 503 });
  }
  if (!source) return response({ error: "Brief not found." }, { status: 404 });

  let apiKey: string | null;
  try {
    apiKey = await new OpenRouterKeyStore().getApiKey();
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenRouter settings are unavailable.";
    return response({ error: message }, { status: 503 });
  }
  if (!apiKey) {
    return response(
      { error: "Add an OpenRouter API key in Settings before drafting." },
      { status: 409 },
    );
  }

  const encoder = new TextEncoder();
  const createdBy = request.headers.get("cf-access-authenticated-user-email");
  let acceptingEvents = true;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (!acceptingEvents) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          acceptingEvents = false;
        }
      };
      heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000);

      void runDrafting(source, parsedRequest.data, createdBy, {
        gateway: new OpenRouterGateway(apiKey),
        repository,
        onEvent: send,
      })
        .catch(() => {
          // The orchestrator emits a draft_session_failed event with the useful error.
        })
        .finally(() => {
          if (heartbeat) clearInterval(heartbeat);
          if (acceptingEvents) controller.close();
        });
    },
    cancel() {
      acceptingEvents = false;
      if (heartbeat) clearInterval(heartbeat);
      // Drafting continues so the persisted session survives a disconnected browser.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
    },
  });
}

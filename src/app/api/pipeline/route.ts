import { SignalInputSchema } from "@/domain/schemas";
import { OpenRouterGateway } from "@/llm/openrouter";
import { PostgresPipelineRepository } from "@/persistence/postgres-repository";
import { runPipeline } from "@/pipeline/orchestrator";
import { OpenRouterKeyStore } from "@/security/openrouter-key-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const input = SignalInputSchema.safeParse(payload);
  if (!input.success) {
    return Response.json(
      { error: input.error.issues[0]?.message ?? "The signal is invalid." },
      { status: 400 },
    );
  }

  let apiKey: string | null;
  try {
    apiKey = await new OpenRouterKeyStore().getApiKey();
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenRouter settings are unavailable.";
    return Response.json({ error: message }, { status: 503 });
  }
  if (!apiKey) {
    return Response.json(
      { error: "Add an OpenRouter API key in Settings before running the pipeline." },
      { status: 409 },
    );
  }

  const encoder = new TextEncoder();
  let acceptingEvents = true;
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

      void runPipeline(input.data, {
        gateway: new OpenRouterGateway(apiKey),
        repository: new PostgresPipelineRepository(),
        onEvent: send,
      })
        .catch(() => {
          // The orchestrator emits a pipeline_failed event with the useful error.
        })
        .finally(() => {
          if (acceptingEvents) controller.close();
        });
    },
    cancel() {
      // A disconnected operator should not abort persistence for an in-flight run.
      acceptingEvents = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

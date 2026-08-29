import { z } from "zod";
import type { CompletionRequest, CompletionResult, LlmGateway } from "./gateway";

interface OpenRouterResponse {
  id?: string;
  model?: string;
  provider?: string;
  choices?: Array<{
    message?: { content?: string | Array<{ type?: string; text?: string }> };
    error?: { message?: string };
    finish_reason?: string | null;
    native_finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number | string;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
}

type FetchLike = typeof fetch;

interface OutputFailureDetails {
  schema: string;
  requestedModel: string;
  returnedModel: string;
  provider: string | null;
  generationId: string | null;
  finishReason: string | null;
  nativeFinishReason: string | null;
  responseLength: number;
}

function extractContent(response: OpenRouterResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  return "";
}

function parseJson(content: string): unknown {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(unfenced);
}

export class OpenRouterGateway implements LlmGateway {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://openrouter.ai/api/v1/chat/completions",
    private readonly fetcher: FetchLike = fetch,
  ) {}

  private outputFailureDetails<T>(
    request: CompletionRequest<T>,
    payload: OpenRouterResponse,
    content: string,
  ): OutputFailureDetails {
    const choice = payload.choices?.[0];
    return {
      schema: request.schemaName,
      requestedModel: request.config.model,
      returnedModel: payload.model ?? request.config.model,
      provider: payload.provider ?? null,
      generationId: payload.id ?? null,
      finishReason: choice?.finish_reason ?? null,
      nativeFinishReason: choice?.native_finish_reason ?? null,
      responseLength: content.length,
    };
  }

  async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
    const jsonSchema = z.toJSONSchema(request.schema, {
      target: "draft-7",
      unrepresentable: "any",
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
          "X-Title": process.env.OPENROUTER_APP_NAME ?? "Axelyn Signal",
          "X-OpenRouter-Metadata": "enabled",
        },
        body: JSON.stringify({
          model: request.config.model,
          ...(request.config.temperature === undefined
            ? {}
            : { temperature: request.config.temperature }),
          ...(request.config.reasoningEffort
            ? { reasoning: { effort: request.config.reasoningEffort, exclude: true } }
            : {}),
          ...(request.config.verbosity ? { verbosity: request.config.verbosity } : {}),
          max_tokens: request.config.maxOutputTokens,
          stream: false,
          ...(request.config.requireStructuredOutputProvider
            ? { provider: { require_parameters: true } }
            : {}),
          plugins: [{ id: "response-healing" }],
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: jsonSchema,
            },
          },
        }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as OpenRouterResponse;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? `OpenRouter request failed with ${response.status}.`);
      }
      if (payload.choices?.[0]?.error) {
        throw new Error(payload.choices[0].error.message ?? "The model could not complete the request.");
      }

      const content = extractContent(payload);
      if (!content) throw new Error("The selected model returned no structured output.");

      let parsed: unknown;
      try {
        parsed = parseJson(content);
      } catch (error) {
        const details = this.outputFailureDetails(request, payload, content);
        console.error("OpenRouter structured output was not parseable", {
          ...details,
          parseError: error instanceof Error ? error.message : "Unknown JSON parse error",
        });
        const finishReasons = [details.finishReason, details.nativeFinishReason]
          .filter((reason): reason is string => Boolean(reason))
          .map((reason) => reason.toLowerCase());
        if (finishReasons.includes("length") || finishReasons.includes("max_tokens")) {
          throw new Error(
            "The selected model reached its output limit before completing the structured response. Increase this stage's output-token limit or shorten its input.",
          );
        }
        throw new Error(
          "The selected model returned malformed JSON after response healing. Retry the run.",
        );
      }

      const validated = request.schema.safeParse(parsed);
      if (!validated.success) {
        const issue = validated.error.issues[0];
        console.error("OpenRouter structured output failed schema validation", {
          ...this.outputFailureDetails(request, payload, content),
          issuePath: issue.path.join(".") || "root",
          issueMessage: issue.message,
        });
        throw new Error(`The selected model returned an invalid ${request.schemaName} payload at ${issue.path.join(".") || "root"}: ${issue.message}`);
      }

      const promptTokens = payload.usage?.prompt_tokens ?? 0;
      const completionTokens = payload.usage?.completion_tokens ?? 0;
      const returnedCost = Number(payload.usage?.cost);
      const estimatedCost =
        promptTokens * request.config.inputPricePerToken +
        completionTokens * request.config.outputPricePerToken;

      return {
        data: validated.data,
        model: payload.model ?? request.config.model,
        provider: payload.provider ?? null,
        generationId: payload.id ?? null,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: payload.usage?.total_tokens ?? promptTokens + completionTokens,
          reasoning_tokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
          cached_tokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          cost: Number.isFinite(returnedCost) ? returnedCost : null,
          estimated_cost: estimatedCost,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("OpenRouter timed out after 120 seconds.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

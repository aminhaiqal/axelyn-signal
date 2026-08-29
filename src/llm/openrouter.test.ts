import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CompletionRequest } from "./gateway";
import { OpenRouterGateway } from "./openrouter";

const OutputSchema = z.object({ message: z.string() });

const request: CompletionRequest<z.infer<typeof OutputSchema>> = {
  system: "Return structured output.",
  user: "Write a message.",
  schemaName: "test_message",
  schema: OutputSchema,
  config: {
    model: "anthropic/claude-sonnet-5",
    reasoningEffort: "low",
    verbosity: "medium",
    requireStructuredOutputProvider: true,
    maxOutputTokens: 500,
    inputPricePerToken: 0.000001,
    outputPricePerToken: 0.000002,
  },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function completion(content: string, finishReason = "stop") {
  return {
    id: "generation-1",
    model: "anthropic/claude-sonnet-5",
    provider: "Anthropic",
    choices: [{
      finish_reason: finishReason,
      native_finish_reason: finishReason,
      message: { content },
    }],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 8,
      total_tokens: 28,
      cost: 0.00003,
    },
  };
}

describe("OpenRouterGateway structured output", () => {
  it("requires a capable provider when the stage needs strict structured output", async () => {
    let body: Record<string, unknown> = {};
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(completion('{"message":"Ready"}'));
    }) as typeof fetch;

    const result = await new OpenRouterGateway(
      "test-openrouter-key",
      "https://openrouter.test/chat/completions",
      fetcher,
    ).complete(request);

    expect(result.data).toEqual({ message: "Ready" });
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.plugins).toEqual([{ id: "response-healing" }]);
    expect(body.stream).toBe(false);
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "test_message", strict: true },
    });
  });

  it("leaves provider routing unrestricted for stages with other model parameters", async () => {
    let body: Record<string, unknown> = {};
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(completion('{"message":"Ready"}'));
    }) as typeof fetch;

    await new OpenRouterGateway(
      "test-openrouter-key",
      "https://openrouter.test/chat/completions",
      fetcher,
    ).complete({
      ...request,
      config: { ...request.config, requireStructuredOutputProvider: false },
    });

    expect(body).not.toHaveProperty("provider");
  });

  it("reports output-limit truncation separately from malformed JSON", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = (async () => jsonResponse(completion('{"message":"unfinished', "length"))) as typeof fetch;

    await expect(new OpenRouterGateway(
      "test-openrouter-key",
      "https://openrouter.test/chat/completions",
      fetcher,
    ).complete(request)).rejects.toThrow("reached its output limit");

    expect(log).toHaveBeenCalledWith(
      "OpenRouter structured output was not parseable",
      expect.objectContaining({
        generationId: "generation-1",
        finishReason: "length",
        responseLength: 22,
      }),
    );
    log.mockRestore();
  });

  it("reports malformed complete responses after healing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = (async () => jsonResponse(completion("not json"))) as typeof fetch;

    await expect(new OpenRouterGateway(
      "test-openrouter-key",
      "https://openrouter.test/chat/completions",
      fetcher,
    ).complete(request)).rejects.toThrow("malformed JSON after response healing");

    expect(log).toHaveBeenCalledWith(
      "OpenRouter structured output was not parseable",
      expect.objectContaining({
        provider: "Anthropic",
        finishReason: "stop",
        responseLength: 8,
      }),
    );
    log.mockRestore();
  });
});

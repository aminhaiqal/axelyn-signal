import { describe, expect, it } from "vitest";
import { BufferGraphqlClient } from "./client";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BufferGraphqlClient", () => {
  it("discovers organizations and normalizes their unlocked channels", async () => {
    const requests: Array<{ authorization: string | null; body: Record<string, unknown> }> = [];
    const responses = [
      jsonResponse({ data: { account: { organizations: [{ id: "org-1", name: "Axelyn" }] } } }),
      jsonResponse({ data: { channels: [{
        id: "channel-1",
        name: "axelyn",
        displayName: "Axelyn Technologies",
        service: "LINKEDIN",
        isQueuePaused: false,
        isDisconnected: false,
      }, {
        id: "channel-2",
        name: "stale-account",
        displayName: null,
        service: "THREADS",
        isQueuePaused: false,
        isDisconnected: true,
      }] } }),
    ];
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return responses.shift() as Response;
    }) as typeof fetch;

    const channels = await new BufferGraphqlClient(
      "test-buffer-key-1234567890",
      "https://buffer.test/graphql",
      fetcher,
    ).listChannels();

    expect(channels).toEqual([{
      id: "channel-1",
      name: "Axelyn Technologies",
      service: "linkedin",
      organization_id: "org-1",
      organization_name: "Axelyn",
      is_queue_paused: false,
    }]);
    expect(requests.every((request) => request.authorization === "Bearer test-buffer-key-1234567890")).toBe(true);
  });

  it("creates posts with Buffer's draft-only flag", async () => {
    let requestBody: { variables?: { input?: Record<string, unknown> } } = {};
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
      return jsonResponse({ data: { createPost: {
        __typename: "PostActionSuccess",
        post: { id: "post-1", text: "Approved proof" },
      } } });
    }) as typeof fetch;

    const post = await new BufferGraphqlClient(
      "test-buffer-key-1234567890",
      "https://buffer.test/graphql",
      fetcher,
    ).createDraftPost("channel-1", "Approved proof");

    expect(post.id).toBe("post-1");
    expect(requestBody.variables?.input).toMatchObject({
      channelId: "channel-1",
      saveToDraft: true,
      schedulingType: "automatic",
      mode: "addToQueue",
    });
    expect(requestBody.variables?.input).not.toHaveProperty("aiAssisted");
    expect(requestBody.variables?.input).not.toHaveProperty("source");
  });
});

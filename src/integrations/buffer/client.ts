import { z } from "zod";
import { BufferChannelSchema, type BufferChannel } from "@/domain/buffer";

const OrganizationSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const RemoteChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  displayName: z.string().nullish(),
  service: z.string().min(1),
  isQueuePaused: z.boolean().default(false),
  isDisconnected: z.boolean().default(false),
});

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

type FetchLike = typeof fetch;

export class BufferApiError extends Error {}
export class BufferTransportError extends BufferApiError {}
export class BufferMutationError extends BufferApiError {}

export interface BufferGateway {
  listChannels(): Promise<BufferChannel[]>;
  getChannel(id: string): Promise<BufferChannel>;
  createDraftPost(channelId: string, content: string): Promise<{ id: string; text: string }>;
}

export class BufferGraphqlClient implements BufferGateway {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://api.buffer.com",
    private readonly fetcher: FetchLike = fetch,
  ) {}

  private async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      let payload: GraphqlEnvelope<T>;
      try {
        payload = await response.json() as GraphqlEnvelope<T>;
      } catch {
        throw new BufferTransportError("Buffer returned an unreadable response.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new BufferApiError("Buffer rejected the API key. Rotate it in Buffer and reconnect.");
      }
      if (!response.ok) {
        throw new BufferTransportError(`Buffer returned HTTP ${response.status}.`);
      }
      if (payload.errors?.length) {
        throw new BufferApiError(payload.errors[0]?.message ?? "Buffer rejected the request.");
      }
      if (!payload.data) throw new BufferTransportError("Buffer returned no data.");
      return payload.data;
    } catch (error) {
      if (error instanceof BufferApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BufferTransportError("Buffer timed out after 30 seconds.");
      }
      throw new BufferTransportError("Buffer could not be reached.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async organizations(): Promise<Array<z.infer<typeof OrganizationSchema>>> {
    const data = await this.request<unknown>(`
      query AxelynBufferOrganizations {
        account { organizations { id name } }
      }
    `);
    return z.object({
      account: z.object({ organizations: z.array(OrganizationSchema) }),
    }).parse(data).account.organizations;
  }

  async listChannels(): Promise<BufferChannel[]> {
    const organizations = await this.organizations();
    const groups = await Promise.all(organizations.map(async (organization) => {
      const data = await this.request<unknown>(`
        query AxelynBufferChannels($organizationId: OrganizationId!) {
          channels(input: { organizationId: $organizationId, filter: { isLocked: false } }) {
            id name displayName service isQueuePaused isDisconnected
          }
        }
      `, { organizationId: organization.id });
      const channels = z.object({ channels: z.array(RemoteChannelSchema) }).parse(data).channels;
      return channels.filter((channel) => !channel.isDisconnected).map((channel) => BufferChannelSchema.parse({
        id: channel.id,
        name: channel.displayName || channel.name || channel.id,
        service: channel.service.toLowerCase(),
        organization_id: organization.id,
        organization_name: organization.name,
        is_queue_paused: channel.isQueuePaused,
      }));
    }));
    return groups.flat().sort((a, b) =>
      a.organization_name.localeCompare(b.organization_name) || a.name.localeCompare(b.name)
    );
  }

  async getChannel(id: string): Promise<BufferChannel> {
    const channels = await this.listChannels();
    const channel = channels.find((item) => item.id === id);
    if (!channel) throw new BufferApiError("That Buffer channel is unavailable or locked.");
    return channel;
  }

  async createDraftPost(channelId: string, content: string): Promise<{ id: string; text: string }> {
    const data = await this.request<unknown>(`
      mutation AxelynCreateBufferDraft($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess { post { id text } }
          ... on MutationError { message }
        }
      }
    `, {
      input: {
        text: content,
        channelId,
        schedulingType: "automatic",
        mode: "addToQueue",
        saveToDraft: true,
      },
    });
    const result = z.object({
      createPost: z.object({
        __typename: z.string(),
        post: z.object({ id: z.string().min(1), text: z.string() }).optional(),
        message: z.string().optional(),
      }),
    }).parse(data).createPost;
    if (result.__typename === "MutationError" || !result.post) {
      throw new BufferMutationError(result.message ?? "Buffer could not create the draft post.");
    }
    return result.post;
  }
}

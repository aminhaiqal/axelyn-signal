import { describe, expect, it } from "vitest";
import type {
  BufferChannel,
  BufferDelivery,
  BufferExportClaim,
} from "@/domain/buffer";
import type { BufferDeliveryRepository } from "@/persistence/buffer-types";
import type { BufferGateway } from "./client";
import { exportApprovedDraftToBuffer } from "./export";

const channel: BufferChannel = {
  id: "channel-linkedin",
  name: "Axelyn LinkedIn",
  service: "linkedin",
  organization_id: "org-1",
  organization_name: "Axelyn",
  is_queue_paused: false,
};

const pendingDelivery: BufferDelivery = {
  id: "delivery-1",
  draft_revision_id: "revision-1",
  platform: "LINKEDIN",
  channel_id: channel.id,
  channel_name: channel.name,
  channel_service: channel.service,
  status: "PENDING",
  buffer_post_id: null,
  error: null,
  created_by: "editor@example.com",
  created_at: new Date().toISOString(),
  completed_at: null,
};

class MemoryDeliveryRepository implements BufferDeliveryRepository {
  claim: BufferExportClaim | null = {
    delivery: pendingDelivery,
    content: "Approved writing that should land in Buffer as a draft.",
    claimed: true,
  };
  completedWith: string | null = null;
  failedWith: string | null = null;

  async claimDelivery() { return this.claim; }
  async completeDelivery(_deliveryId: string, bufferPostId: string): Promise<BufferDelivery> {
    this.completedWith = bufferPostId;
    return { ...pendingDelivery, status: "DELIVERED", buffer_post_id: bufferPostId };
  }
  async failDelivery(_deliveryId: string, error: string) { this.failedWith = error; }
}

class MemoryBufferGateway implements BufferGateway {
  createCalls = 0;
  channel = channel;
  failure: Error | null = null;

  async listChannels() { return [this.channel]; }
  async getChannel() { return this.channel; }
  async createDraftPost(_channelId: string, content: string) {
    this.createCalls += 1;
    if (this.failure) throw this.failure;
    return { id: "buffer-post-1", text: content };
  }
}

describe("exportApprovedDraftToBuffer", () => {
  it("creates one Buffer draft and completes the delivery ledger", async () => {
    const gateway = new MemoryBufferGateway();
    const repository = new MemoryDeliveryRepository();

    const delivery = await exportApprovedDraftToBuffer(
      "session-1",
      { platform: "LINKEDIN", channel_id: channel.id },
      "editor@example.com",
      { gateway, repository },
    );

    expect(gateway.createCalls).toBe(1);
    expect(repository.completedWith).toBe("buffer-post-1");
    expect(delivery.status).toBe("DELIVERED");
  });

  it("returns an existing completed handoff without creating a duplicate", async () => {
    const gateway = new MemoryBufferGateway();
    const repository = new MemoryDeliveryRepository();
    repository.claim = {
      delivery: { ...pendingDelivery, status: "DELIVERED", buffer_post_id: "existing-post" },
      content: "Approved writing",
      claimed: false,
    };

    const delivery = await exportApprovedDraftToBuffer(
      "session-1",
      { platform: "LINKEDIN", channel_id: channel.id },
      null,
      { gateway, repository },
    );

    expect(gateway.createCalls).toBe(0);
    expect(delivery.buffer_post_id).toBe("existing-post");
  });

  it("rejects a channel from the wrong platform before claiming a delivery", async () => {
    const gateway = new MemoryBufferGateway();
    gateway.channel = { ...channel, id: "channel-threads", service: "threads" };
    const repository = new MemoryDeliveryRepository();

    await expect(exportApprovedDraftToBuffer(
      "session-1",
      { platform: "LINKEDIN", channel_id: gateway.channel.id },
      null,
      { gateway, repository },
    )).rejects.toThrow("LinkedIn Buffer channel");
    expect(gateway.createCalls).toBe(0);
  });

  it("records a failed handoff so it cannot be retried blindly", async () => {
    const gateway = new MemoryBufferGateway();
    gateway.failure = new Error("Buffer could not be reached.");
    const repository = new MemoryDeliveryRepository();

    await expect(exportApprovedDraftToBuffer(
      "session-1",
      { platform: "LINKEDIN", channel_id: channel.id },
      null,
      { gateway, repository },
    )).rejects.toThrow("could not be reached");
    expect(repository.failedWith).toBe("Buffer could not be reached.");
  });
});

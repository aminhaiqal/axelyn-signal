import type { BufferDelivery, BufferExportRequest } from "@/domain/buffer";
import type { BufferDeliveryRepository } from "@/persistence/buffer-types";
import type { BufferGateway } from "./client";

export interface BufferExportDependencies {
  gateway: BufferGateway;
  repository: BufferDeliveryRepository;
}

export class BufferExportValidationError extends Error {}

function expectedService(platform: BufferExportRequest["platform"]): string {
  return platform === "LINKEDIN" ? "linkedin" : "threads";
}

export async function exportApprovedDraftToBuffer(
  sessionId: string,
  request: BufferExportRequest,
  createdBy: string | null,
  dependencies: BufferExportDependencies,
): Promise<BufferDelivery> {
  const channel = await dependencies.gateway.getChannel(request.channel_id);
  if (channel.service.toLowerCase() !== expectedService(request.platform)) {
    throw new BufferExportValidationError(
      `Choose a ${request.platform === "LINKEDIN" ? "LinkedIn" : "Threads"} Buffer channel for this proof.`,
    );
  }

  const claim = await dependencies.repository.claimDelivery(
    sessionId,
    request.platform,
    channel,
    createdBy,
  );
  if (!claim) throw new Error("Drafting session not found.");
  if (!claim.claimed) return claim.delivery;

  try {
    const post = await dependencies.gateway.createDraftPost(channel.id, claim.content);
    return await dependencies.repository.completeDelivery(claim.delivery.id, post.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Buffer draft creation failed.";
    await dependencies.repository.failDelivery(claim.delivery.id, message);
    throw error;
  }
}

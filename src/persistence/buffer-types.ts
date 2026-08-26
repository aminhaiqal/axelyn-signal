import type {
  BufferChannel,
  BufferDelivery,
  BufferExportClaim,
} from "@/domain/buffer";
import type { DraftPlatform } from "@/domain/drafts";

export interface BufferDeliveryRepository {
  claimDelivery(
    sessionId: string,
    platform: DraftPlatform,
    channel: BufferChannel,
    createdBy: string | null,
  ): Promise<BufferExportClaim | null>;
  completeDelivery(deliveryId: string, bufferPostId: string): Promise<BufferDelivery>;
  failDelivery(deliveryId: string, error: string): Promise<void>;
}

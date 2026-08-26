import { z } from "zod";
import { DraftPlatformSchema, type DraftPlatform } from "./drafts";

export const BufferChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  service: z.string().min(1),
  organization_id: z.string().min(1),
  organization_name: z.string().min(1),
  is_queue_paused: z.boolean(),
});

export const BufferDeliveryStatusSchema = z.enum([
  "PENDING",
  "DELIVERED",
  "FAILED",
]);

export const BufferExportRequestSchema = z.object({
  platform: DraftPlatformSchema,
  channel_id: z.string().trim().min(1).max(300),
});

export interface BufferKeyStatus {
  configured: boolean;
  encryption_ready: boolean;
  display_hint: string | null;
  updated_at: string | null;
}

export interface BufferDelivery {
  id: string;
  draft_revision_id: string;
  platform: DraftPlatform;
  channel_id: string;
  channel_name: string;
  channel_service: string;
  status: BufferDeliveryStatus;
  buffer_post_id: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface BufferExportClaim {
  delivery: BufferDelivery;
  content: string;
  claimed: boolean;
}

export type BufferChannel = z.infer<typeof BufferChannelSchema>;
export type BufferDeliveryStatus = z.infer<typeof BufferDeliveryStatusSchema>;
export type BufferExportRequest = z.infer<typeof BufferExportRequestSchema>;

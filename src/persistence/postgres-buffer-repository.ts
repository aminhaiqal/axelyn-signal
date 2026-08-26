import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  BufferDeliveryStatusSchema,
  type BufferChannel,
  type BufferDelivery,
  type BufferExportClaim,
} from "@/domain/buffer";
import { PLATFORM_LIMITS, type DraftPlatform } from "@/domain/drafts";
import type { BufferDeliveryRepository } from "./buffer-types";
import { ensureDatabase, getPool } from "./postgres";

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export function mapBufferDelivery(row: Record<string, unknown>): BufferDelivery {
  return {
    id: String(row.id),
    draft_revision_id: String(row.draft_revision_id),
    platform: row.platform as DraftPlatform,
    channel_id: String(row.channel_id),
    channel_name: String(row.channel_name),
    channel_service: String(row.channel_service),
    status: BufferDeliveryStatusSchema.parse(row.status),
    buffer_post_id: row.buffer_post_id ? String(row.buffer_post_id) : null,
    error: row.error ? String(row.error) : null,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: iso(row.created_at),
    completed_at: row.completed_at ? iso(row.completed_at) : null,
  };
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class BufferDeliveryConflictError extends Error {}
export class BufferDeliveryValidationError extends Error {}

export class PostgresBufferDeliveryRepository implements BufferDeliveryRepository {
  async claimDelivery(
    sessionId: string,
    platform: DraftPlatform,
    channel: BufferChannel,
    createdBy: string | null,
  ): Promise<BufferExportClaim | null> {
    return transaction(async (client) => {
      const sessionResult = await client.query(
        "SELECT id FROM drafting_sessions WHERE id = $1 FOR UPDATE",
        [sessionId],
      );
      if (!sessionResult.rows[0]) return null;

      const revisionResult = await client.query(`
        SELECT id, content, character_count, approved_at
        FROM social_draft_revisions
        WHERE drafting_session_id = $1 AND platform = $2 AND deleted_at IS NULL
        ORDER BY revision DESC
        LIMIT 1
      `, [sessionId, platform]);
      const revision = revisionResult.rows[0] as Record<string, unknown> | undefined;
      if (!revision) throw new BufferDeliveryValidationError("The selected platform has no draft.");
      if (!revision.approved_at) {
        throw new BufferDeliveryValidationError(
          "Approve the current revision before sending it to Buffer.",
        );
      }
      if (Number(revision.character_count) > PLATFORM_LIMITS[platform]) {
        throw new BufferDeliveryValidationError(
          `The approved ${platform === "LINKEDIN" ? "LinkedIn" : "Threads"} revision is over its platform limit.`,
        );
      }

      const existingResult = await client.query(`
        SELECT * FROM buffer_deliveries
        WHERE draft_revision_id = $1 AND channel_id = $2
      `, [revision.id, channel.id]);
      const existing = existingResult.rows[0] as Record<string, unknown> | undefined;
      if (existing) {
        const delivery = mapBufferDelivery(existing);
        if (delivery.status !== "DELIVERED") {
          throw new BufferDeliveryConflictError(
            "This revision already has an unresolved Buffer handoff. Check Buffer before trying another revision.",
          );
        }
        return { delivery, content: String(revision.content), claimed: false };
      }

      const id = randomUUID();
      const insertResult = await client.query(`
        INSERT INTO buffer_deliveries (
          id, draft_revision_id, platform, channel_id, channel_name,
          channel_service, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
        RETURNING *
      `, [
        id,
        revision.id,
        platform,
        channel.id,
        channel.name,
        channel.service,
        createdBy,
      ]);
      return {
        delivery: mapBufferDelivery(insertResult.rows[0] as Record<string, unknown>),
        content: String(revision.content),
        claimed: true,
      };
    });
  }

  async completeDelivery(deliveryId: string, bufferPostId: string): Promise<BufferDelivery> {
    await ensureDatabase();
    const result = await getPool().query(`
      UPDATE buffer_deliveries
      SET status = 'DELIVERED', buffer_post_id = $1, error = NULL, completed_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [bufferPostId, deliveryId]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("The Buffer delivery record could not be completed.");
    return mapBufferDelivery(row);
  }

  async failDelivery(deliveryId: string, error: string): Promise<void> {
    await ensureDatabase();
    await getPool().query(`
      UPDATE buffer_deliveries
      SET status = 'FAILED', error = $1, completed_at = NOW()
      WHERE id = $2
    `, [error, deliveryId]);
  }
}

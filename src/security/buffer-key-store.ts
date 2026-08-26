import { z } from "zod";
import type { BufferKeyStatus } from "@/domain/buffer";
import { ensureDatabase, getPool } from "@/persistence/postgres";
import {
  decryptSecret,
  encryptSecret,
  encryptionIsReady,
} from "./secret-crypto";

const SECRET_NAME = "buffer_api_key";

export const BufferApiKeySchema = z.string()
  .trim()
  .min(20, "Enter a complete Buffer API key.")
  .max(512, "The API key is too long.")
  .refine((value) => !/\s/.test(value), "The API key cannot contain spaces.")
  .refine((value) => value !== "replace_me", "Replace the placeholder with a real API key.");

function displayHint(apiKey: string): string {
  return `buffer-••••${apiKey.slice(-4)}`;
}

export class BufferKeyStore {
  async status(): Promise<BufferKeyStatus> {
    await ensureDatabase();
    const result = await getPool().query(
      "SELECT display_hint, updated_at FROM app_secrets WHERE name = $1",
      [SECRET_NAME],
    );
    const row = result.rows[0] as { display_hint: string; updated_at: Date } | undefined;
    return {
      configured: Boolean(row),
      encryption_ready: encryptionIsReady(),
      display_hint: row?.display_hint ?? null,
      updated_at: row?.updated_at?.toISOString() ?? null,
    };
  }

  async getApiKey(): Promise<string | null> {
    await ensureDatabase();
    const result = await getPool().query(
      "SELECT ciphertext, iv, auth_tag FROM app_secrets WHERE name = $1",
      [SECRET_NAME],
    );
    const row = result.rows[0] as {
      ciphertext: string;
      iv: string;
      auth_tag: string;
    } | undefined;
    if (!row) return null;
    return decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
  }

  async saveApiKey(rawApiKey: string): Promise<BufferKeyStatus> {
    const apiKey = BufferApiKeySchema.parse(rawApiKey);
    const encrypted = encryptSecret(apiKey);
    await ensureDatabase();
    await getPool().query(`
      INSERT INTO app_secrets (name, ciphertext, iv, auth_tag, display_hint)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (name) DO UPDATE SET
        ciphertext = EXCLUDED.ciphertext,
        iv = EXCLUDED.iv,
        auth_tag = EXCLUDED.auth_tag,
        display_hint = EXCLUDED.display_hint,
        updated_at = NOW()
    `, [
      SECRET_NAME,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      displayHint(apiKey),
    ]);
    return this.status();
  }

  async deleteApiKey(): Promise<BufferKeyStatus> {
    await ensureDatabase();
    await getPool().query("DELETE FROM app_secrets WHERE name = $1", [SECRET_NAME]);
    return this.status();
  }
}

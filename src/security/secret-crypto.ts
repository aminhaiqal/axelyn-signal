import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function parseEncryptionKey(raw = process.env.SETTINGS_ENCRYPTION_KEY): Buffer {
  if (!raw) {
    throw new Error("SETTINGS_ENCRYPTION_KEY is not configured.");
  }

  const value = raw.trim();
  let key: Buffer;
  if (/^[a-f\d]{64}$/i.test(value)) {
    key = Buffer.from(value, "hex");
  } else if (/^[A-Za-z\d+/]{43}=$/.test(value)) {
    key = Buffer.from(value, "base64");
  } else {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex value.");
  }
  if (key.length !== 32) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

export function encryptionIsReady(): boolean {
  try {
    parseEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(value: string, rawKey?: string): EncryptedSecret {
  const key = parseEncryptionKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret, rawKey?: string): string {
  const key = parseEncryptionKey(rawKey);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

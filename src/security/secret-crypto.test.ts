import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "./secret-crypto";

const base64Key = Buffer.alloc(32, 7).toString("base64");

describe("credential encryption", () => {
  it("round-trips a secret without storing plaintext", () => {
    const plaintext = "synthetic-credential-value-for-testing";
    const encrypted = encryptSecret(plaintext, base64Key);

    expect(encrypted.ciphertext).not.toContain(plaintext);
    expect(decryptSecret(encrypted, base64Key)).toBe(plaintext);
  });

  it("rejects an invalid master key", () => {
    expect(() => parseEncryptionKey("not-a-32-byte-key")).toThrow(/32-byte base64/);
  });

  it("detects ciphertext tampering through the authentication tag", () => {
    const encrypted = encryptSecret("sensitive-value", base64Key);
    const corrupted = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA`,
    };

    expect(() => decryptSecret(corrupted, base64Key)).toThrow();
  });
});

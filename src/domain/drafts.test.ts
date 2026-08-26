import { describe, expect, it } from "vitest";
import { DraftRequestSchema, PLATFORM_LIMITS, countDraftCharacters } from "./drafts";

describe("draft domain contracts", () => {
  it("requires a unique, bounded platform selection", () => {
    expect(DraftRequestSchema.safeParse({ platforms: ["LINKEDIN"] }).success).toBe(true);
    expect(DraftRequestSchema.safeParse({ platforms: ["LINKEDIN", "THREADS"] }).success).toBe(true);
    expect(DraftRequestSchema.safeParse({ platforms: [] }).success).toBe(false);
    expect(DraftRequestSchema.safeParse({ platforms: ["THREADS", "THREADS"] }).success).toBe(false);
  });

  it("counts Unicode code points rather than UTF-16 storage units", () => {
    expect("😀".length).toBe(2);
    expect(countDraftCharacters("A😀B")).toBe(3);
  });

  it("keeps platform limits authoritative in application code", () => {
    expect(PLATFORM_LIMITS).toEqual({ LINKEDIN: 3000, THREADS: 500 });
  });
});

import type { DraftAgentName } from "@/config/agents";
import type { DraftPlatform, DraftSession } from "@/domain/drafts";

export type DraftingEvent =
  | {
      type: "draft_session_started";
      session_id: string;
      models: Record<string, string>;
      platforms: DraftPlatform[];
    }
  | { type: "draft_stage_started"; session_id: string; stage: DraftAgentName | "repair" }
  | {
      type: "draft_stage_completed";
      session_id: string;
      stage: DraftAgentName | "repair";
      summary: string;
    }
  | { type: "draft_session_completed"; session_id: string; session: DraftSession }
  | { type: "draft_session_failed"; session_id: string; error: string };

export type DraftingEventHandler = (event: DraftingEvent) => void | Promise<void>;

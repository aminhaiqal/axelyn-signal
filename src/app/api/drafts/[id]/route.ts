import { z } from "zod";
import { DraftPlatformSchema, type DraftSession } from "@/domain/drafts";
import { PostgresDraftRepository } from "@/persistence/postgres-draft-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const PatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    platform: DraftPlatformSchema,
    content: z.string().trim().min(40, "Add a little more substance before saving.").max(12000),
  }),
  z.object({ action: z.literal("approve"), platform: DraftPlatformSchema }),
  z.object({
    action: z.literal("delete"),
    platform: DraftPlatformSchema,
    revision_id: z.string().uuid(),
  }),
]);

function response(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return response({ error: "Drafting session not found." }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(payload);
  if (!parsed.success) {
    return response(
      { error: parsed.error.issues[0]?.message ?? "The draft update is invalid." },
      { status: 400 },
    );
  }

  const repository = new PostgresDraftRepository();
  const operator = request.headers.get("cf-access-authenticated-user-email");
  try {
    let session: DraftSession | null;
    if (parsed.data.action === "save") {
      session = await repository.saveOperatorRevision(
        id, parsed.data.platform, parsed.data.content, operator,
      );
    } else if (parsed.data.action === "delete") {
      session = await repository.deleteRevision(
        id, parsed.data.platform, parsed.data.revision_id, operator,
      );
    } else {
      session = await repository.approveCurrentRevision(id, parsed.data.platform, operator);
    }
    if (!session) return response({ error: "Drafting session not found." }, { status: 404 });
    return response({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The draft could not be updated.";
    return response({ error: message }, { status: 409 });
  }
}

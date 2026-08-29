import { z } from "zod";
import { PostgresPipelineRepository } from "@/persistence/postgres-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RunIdSchema = z.string().uuid();

async function runId(
  params: Promise<{ id: string }>,
): Promise<string | null> {
  const parsed = RunIdSchema.safeParse((await params).id);
  return parsed.success ? parsed.data : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = await runId(params);
  if (!id) return Response.json({ error: "Run not found." }, { status: 404 });
  const run = await new PostgresPipelineRepository().getRun(id);
  if (!run) return Response.json({ error: "Run not found." }, { status: 404 });
  return Response.json({ run });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = await runId(params);
  if (!id) return Response.json({ error: "Run not found." }, { status: 404 });

  const deleted = await new PostgresPipelineRepository().deleteRun(id);
  if (!deleted) return Response.json({ error: "Run not found." }, { status: 404 });
  return Response.json({ deleted: true, id });
}

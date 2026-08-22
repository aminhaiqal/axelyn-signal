import { PostgresPipelineRepository } from "@/persistence/postgres-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const run = await new PostgresPipelineRepository().getRun(id);
  if (!run) return Response.json({ error: "Run not found." }, { status: 404 });
  return Response.json({ run });
}

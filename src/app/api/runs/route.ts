import { PostgresPipelineRepository } from "@/persistence/postgres-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 12);
  const repository = new PostgresPipelineRepository();
  return Response.json({ runs: await repository.listRuns(Number.isFinite(limit) ? limit : 12) });
}

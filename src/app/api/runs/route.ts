import { SqlitePipelineRepository } from "@/persistence/sqlite-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 12);
  const repository = new SqlitePipelineRepository();
  return Response.json({ runs: repository.listRuns(Number.isFinite(limit) ? limit : 12) });
}

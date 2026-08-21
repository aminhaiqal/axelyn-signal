import { checkDatabase } from "@/persistence/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await checkDatabase();
    return Response.json({ status: "ok", database: "connected" });
  } catch {
    return Response.json({ status: "unhealthy", database: "unavailable" }, { status: 503 });
  }
}

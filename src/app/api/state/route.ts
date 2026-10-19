import { readDesk } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const view = await readDesk();
  return Response.json(view);
}

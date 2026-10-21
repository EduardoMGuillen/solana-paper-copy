import { readMeteoraLive } from "@/lib/lp/forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readMeteoraLive());
}

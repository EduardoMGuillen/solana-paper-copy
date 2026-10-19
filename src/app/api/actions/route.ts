import { runAction, type ActionBody } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ActionBody;
  const result = await runAction(body);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

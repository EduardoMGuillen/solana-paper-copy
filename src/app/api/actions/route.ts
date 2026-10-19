import { runAction } from "@/lib/service";
import type { RiskSettings } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    type?: string;
    active?: boolean;
    id?: string;
    enabled?: boolean;
    wallet?: string;
    settings?: Partial<RiskSettings>;
  };
  const result = await runAction(body);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

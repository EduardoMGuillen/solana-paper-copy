import { meteoraPanel } from "@/lib/lp/panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    return Response.json(await meteoraPanel(Date.now(), refresh));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer Meteora";
    return Response.json({ error: message }, { status: 502 });
  }
}

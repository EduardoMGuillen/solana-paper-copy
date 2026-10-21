import { fetchSolUsd } from "@/lib/bot/market";
import { kickLiveLp } from "@/lib/exec/lp-runner";
import { closeLivePosition, saveLiveParams, setLiveBot, walletDir, walletStatus, withSolUsd, withWallet } from "@/lib/exec/wallet";

async function liveStatus() {
  const [status, solUsd] = await Promise.all([walletStatus(), fetchSolUsd()]);
  return withSolUsd(status, solUsd);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public wallet status only. The secret file is never opened here. */
export async function GET() {
  return Response.json(await liveStatus());
}

/** Start, stop, or save parameters. Saving is refused while the bot is running. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { running?: unknown; params?: unknown; close?: unknown } | null;
  const closing = typeof body?.close === "string" ? body.close : null;
  if (!body || (typeof body.running !== "boolean" && body.params === undefined && !closing)) {
    return Response.json({ ok: false, error: "Indica start, stop o parámetros." }, { status: 400 });
  }
  const acted = typeof body.running === "boolean" || Boolean(closing);
  try {
    const result = await withWallet(() => handle(body, closing));
    if (acted) kickLiveLp();
    return result;
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "No se pudo cambiar el bot.";
    return Response.json({ ok: false, error }, { status: 400 });
  }
}

async function handle(body: { running?: unknown; params?: unknown; close?: unknown }, closing: string | null): Promise<Response> {
  try {
    const dir = walletDir();
    if (closing) {
      const closed = closeLivePosition(dir, closing);
      const status = await liveStatus();
      return Response.json({ ok: closed.error === null, error: closed.error, status }, { status: closed.error ? 400 : 200 });
    }
    if (body.params !== undefined) {
      const saved = saveLiveParams(dir, body.params);
      if (saved.error) {
        const status = await liveStatus();
        return Response.json({ ok: false, error: saved.error, status }, { status: 400 });
      }
    }
    if (typeof body.running === "boolean") {
      const result = setLiveBot(dir, body.running);
      const status = await liveStatus();
      return Response.json({ ok: result.error === null, error: result.error, status }, { status: result.error ? 400 : 200 });
    }
    return Response.json({ ok: true, error: null, status: await liveStatus() });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "No se pudo cambiar el bot.";
    return Response.json({ ok: false, error }, { status: 400 });
  }
}

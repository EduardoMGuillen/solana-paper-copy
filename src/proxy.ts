import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic auth for the whole app: dashboard and every API route.
 * Credentials come from BOT_USER (default "admin") and BOT_PASSWORD.
 * Without BOT_PASSWORD the app only answers on localhost, so a deployed
 * bot never runs open by accident. Use it behind HTTPS (deploy/ uses Caddy).
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Constant-time comparison, so response timing does not leak the password. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function challenge(): NextResponse {
  return new NextResponse("Username and password required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="PolloTraderBot", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}

export function proxy(request: NextRequest) {
  const password = process.env.BOT_PASSWORD;
  if (!password) {
    const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
    if (LOCAL_HOSTS.has(host)) return NextResponse.next();
    return new NextResponse("BOT_PASSWORD is not set. The bot only answers on localhost.", { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return challenge();
  let decoded = "";
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
  } catch {
    return challenge();
  }
  const split = decoded.indexOf(":");
  const user = split >= 0 ? decoded.slice(0, split) : "";
  const pass = split >= 0 ? decoded.slice(split + 1) : "";
  const userOk = safeEqual(user, process.env.BOT_USER || "admin");
  const passOk = safeEqual(pass, password);
  return userOk && passOk ? NextResponse.next() : challenge();
}

export const config = {
  // Everything except Next's static build assets.
  matcher: ["/((?!_next/static|_next/image).*)"],
};

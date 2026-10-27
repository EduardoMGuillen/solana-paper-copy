/** KEY=VALUE lines, like .env.local. Comments and blank lines are skipped; quotes around values are dropped. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Set KEY=value on its existing line, or append it, leaving comments and other keys as they are. */
export function setEnvValue(text: string, key: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("The value cannot contain line breaks.");
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
  if (at >= 0) {
    lines[at] = `${key}=${value}`;
    return lines.join("\n");
  }
  const body = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
  return `${body}${key}=${value}\n`;
}

function maskToken(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-3)}` : value;
}

/** The RPC URL without its secrets, safe to show on screen: long path tokens and query values are cut. */
export function maskRpc(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "(invalid URL)";
  }
  const pathPart = url.pathname.split("/").map(maskToken).join("/");
  const query = [...url.searchParams].map(([key, value]) => `${key}=${maskToken(value)}`).join("&");
  return `${url.host}${pathPart}${query ? `?${query}` : ""}`;
}

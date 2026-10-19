export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLoop } = await import("./lib/service");
  startLoop();
}

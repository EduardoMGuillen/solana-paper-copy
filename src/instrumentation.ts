export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLiveLoop } = await import("./lib/live-loop");
  startLiveLoop();
}

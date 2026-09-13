/**
 * Next runs this once per server start. The web app owns the schema; the
 * gateway waits for it rather than defining a second copy, so there is exactly
 * one definition of the tables in the stack.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureSchema } = await import("./lib/db");
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await ensureSchema();
      console.log("[schema] ready");
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[schema] attempt ${attempt}/10 failed: ${msg}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error("[schema] giving up; the app will retry lazily on first request");
}

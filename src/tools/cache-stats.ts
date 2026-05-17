import { computeCacheStats } from "../lib/cache/cache-stats.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runCacheStats() {
  try {
    const stats = computeCacheStats();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(stats, null, 2) },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

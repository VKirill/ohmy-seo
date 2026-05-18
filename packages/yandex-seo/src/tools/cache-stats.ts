import { computeCacheStats } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

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

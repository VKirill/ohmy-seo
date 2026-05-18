import { deleteByEndpointPrefix } from "@ohmy-seo/mcp-core/cache";
import type { CacheableTool } from "@ohmy-seo/mcp-core/cache";
import type { ApiName } from "./endpoints-spec.js";

export function invalidateOnWrite(
  toolName: CacheableTool,
  _apiName: ApiName,
  endpoint: string,
): number {
  const deleted = deleteByEndpointPrefix(toolName, endpoint);
  process.stderr.write(
    `[cache-invalidate] toolName=${toolName} endpoint=${endpoint} deleted=${deleted}\n`,
  );
  return deleted;
}

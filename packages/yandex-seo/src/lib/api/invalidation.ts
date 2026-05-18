import { deleteByEndpointPrefix } from "../cache/query-cache-repo.js";
import type { CacheableTool } from "../cache/cache-policy.js";
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

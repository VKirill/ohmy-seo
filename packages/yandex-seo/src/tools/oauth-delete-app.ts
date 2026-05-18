import { deleteAppByLabel } from "../lib/db/oauth-apps-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

export async function runDeleteOauthApp(input: { label: string }) {
  try {
    deleteAppByLabel(input.label);
    return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: input.label }) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

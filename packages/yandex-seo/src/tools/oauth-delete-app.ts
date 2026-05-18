import { deleteAppByLabel } from "../lib/db/oauth-apps-repo.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runDeleteOauthApp(input: { label: string }) {
  try {
    deleteAppByLabel(input.label);
    return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: input.label }) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

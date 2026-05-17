import { getCompetition } from "../lib/mutagen-client.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runMutagenCompetition(input: { phrases: string[]; poll_timeout_sec?: number }) {
  try {
    const result = await getCompetition({
      phrases: input.phrases,
      pollTimeoutSec: input.poll_timeout_sec ?? 60,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

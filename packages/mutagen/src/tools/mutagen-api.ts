import { executeMutagenMethod } from "../lib/mutagen-client.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { withCache } from "@ohmy-seo/mcp-core/cache";

// ---------------------------------------------------------------------------
// Common parameter typo detection
// ---------------------------------------------------------------------------

const COMMON_TYPOS: Record<string, { wrong: string; correct: string }[]> = {
  "parser.get": [{ wrong: "parser_type", correct: "parser" }],
  "parser.mass": [
    { wrong: "parser_type", correct: "parser" },
    { wrong: "keys", correct: "keys_list" },
    { wrong: "type", correct: "parser" },
  ],
  "serp.report": [{ wrong: "report_type", correct: "report" }],
};

function detectTypos(method: string, params: Record<string, unknown>): string[] {
  const typos = COMMON_TYPOS[method] ?? [];
  const errors: string[] = [];
  for (const { wrong, correct } of typos) {
    if (wrong in params && !(correct in params)) {
      errors.push(
        `Параметр '${wrong}' не существует в Mutagen API для метода '${method}'. ` +
        `Правильное имя: '${correct}'. См. https://mutagen.ru/?p=api`,
      );
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Tool runner
// ---------------------------------------------------------------------------

export async function runMutagenApi(input: {
  method: string;
  params?: Record<string, unknown>;
  poll_timeout_sec?: number;
  force_refresh?: boolean;
}) {
  try {
    const params = input.params ?? {};
    const pollTimeoutSec = input.poll_timeout_sec ?? 60;

    // Pre-call typo validation — fail fast with a helpful error instead of calling API
    const typoErrors = detectTypos(input.method, params);
    if (typoErrors.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "parameter_typo", messages: typoErrors }, null, 2),
          },
        ],
      };
    }

    const cacheArgs: Record<string, unknown> = { method: input.method, params };

    const result = await withCache(
      {
        toolName: "mutagen_api",
        accountId: null,
        args: cacheArgs,
        forceRefresh: input.force_refresh ?? false,
      },
      () => executeMutagenMethod(input.method, params, pollTimeoutSec),
    );

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

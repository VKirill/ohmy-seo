import { z } from "zod";
import { loadCampaignFolder } from "../lib/yaml-loader.js";
import { renderCampaignBundleToXlsx, defaultXlsxPath } from "../lib/xlsx-renderer.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const InputSchema = z.object({
  folder: z.string().min(1).describe("Absolute path to the campaign folder containing _campaign.yaml and group-*.yaml files"),
  output_path: z.string().optional().describe("Absolute path for the output .xlsx file (default: <folder>/<basename>.xlsx)"),
});

export type DirectRenderToXlsxInput = z.infer<typeof InputSchema>;

export async function runDirectRenderToXlsx(input: DirectRenderToXlsxInput) {
  try {
    const parsed = InputSchema.parse(input);
    const bundle = loadCampaignFolder(parsed.folder);
    const out = parsed.output_path ?? defaultXlsxPath(parsed.folder);
    const result = await renderCampaignBundleToXlsx(bundle, out);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              xlsx_path: result.path,
              rows: result.rows,
              warnings: result.warnings,
              validation_errors: bundle.validation_errors,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

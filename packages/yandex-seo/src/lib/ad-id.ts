import { z } from "zod";

/** Combinatorial ad Ids exceed 2^53. JSON Schema must be string so JS MCP hosts keep the digits. */
export const AdId = z
  .string()
  .regex(/^\d+$/)
  .describe(
    "Ad ID as a STRING of digits. Combinatorial Ids are 19 digits and exceed JS Number precision — never pass a JSON number.",
  );

export const AdIds = z.array(AdId);

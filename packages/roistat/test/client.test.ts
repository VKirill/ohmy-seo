import { afterEach, describe, expect, it } from "vitest";
import { buildRoistatUrl, resolveApiKey, resolveProject } from "../src/client.js";

afterEach(() => {
  delete process.env.ROISTAT_API_KEY;
  delete process.env.ROISTAT_PROJECT_ID;
});

describe("Roistat configuration", () => {
  it("requires an API key", () => {
    expect(() => resolveApiKey()).toThrow("ROISTAT_API_KEY");
    process.env.ROISTAT_API_KEY = " key ";
    expect(resolveApiKey()).toBe("key");
  });

  it("uses an explicit project before the default", () => {
    process.env.ROISTAT_PROJECT_ID = "100";
    expect(resolveProject()).toBe("100");
    expect(resolveProject("200")).toBe("200");
  });

  it("keeps the API key out of URLs", () => {
    const url = buildRoistatUrl("/project/analytics/data", "123", { dimension: "marker_level_1" });
    expect(url).toBe(
      "https://cloud.roistat.com/api/v1/project/analytics/data?project=123&dimension=marker_level_1",
    );
    expect(url).not.toContain("key=");
  });
});

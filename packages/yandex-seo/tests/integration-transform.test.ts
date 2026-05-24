import { describe, it, expect, vi } from "vitest";
import path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Mock transitive dependencies that pull in @ohmy-seo/mcp-core subpaths or
// external API calls. yaml-loader is NOT mocked so loadCampaignFolder works.
// ---------------------------------------------------------------------------
vi.mock("../src/lib/api-gateway.js", () => ({}));
vi.mock("../src/lib/account-resolver.js", () => ({}));
vi.mock("../src/lib/csv-parser.js", () => ({}));
vi.mock("../src/lib/bundle-ledger.js", () => ({}));
vi.mock("../src/lib/payload-builder.js", () => ({}));
vi.mock("../src/tools/direct-upload-image.js", () => ({}));
vi.mock("@ohmy-seo/mcp-core/errors", () => ({
  errorToMcpContent: (e: unknown) => ({ content: [{ type: "text", text: String(e) }] }),
}));

import { loadCampaignFolder } from "../src/lib/yaml-loader.js";
import { extractAdTemplates, resolveCampaignStrategy } from "../src/tools/direct-upload-from-yaml.js";
import { resolveDailyBudgetMicros, findExistingCampaignId } from "../src/lib/upload-pipeline.js";

// ---------------------------------------------------------------------------
// Fixture path — snapshot, not a symlink into the marketing folder
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.resolve(__dirname, "__fixtures__/gce-search");

// Load once — pure reads, no side effects
const bundle = loadCampaignFolder(FIXTURE_DIR);

// ---------------------------------------------------------------------------
// AC1: extractAdTemplates(bundle) for cl04 returns real Title (length > 5),
//       not equal to cluster_id. Title2 present. Text > 30 chars.
// ---------------------------------------------------------------------------
describe("AC1 — cl04 ad template has real content", () => {
  it("cl04 template title is longer than 5 chars and not the cluster_id placeholder", () => {
    const templates = extractAdTemplates(bundle);
    const cl04Templates = templates.filter(
      (t) => t.cluster_filter?.cluster_id_pattern === "^4$"
    );
    expect(cl04Templates.length).toBeGreaterThan(0);

    const first = cl04Templates[0];
    expect(first.title.length).toBeGreaterThan(5);
    expect(first.title).not.toBe("4");
    expect(first.title).not.toBe("cl04");
  });

  it("cl04 template has Title2 present", () => {
    const templates = extractAdTemplates(bundle);
    const cl04Templates = templates.filter(
      (t) => t.cluster_filter?.cluster_id_pattern === "^4$"
    );
    expect(cl04Templates.length).toBeGreaterThan(0);
    expect(cl04Templates[0].title2).toBeTruthy();
    expect((cl04Templates[0].title2 ?? "").length).toBeGreaterThan(0);
  });

  it("cl04 template text is longer than 30 characters", () => {
    const templates = extractAdTemplates(bundle);
    const cl04Templates = templates.filter(
      (t) => t.cluster_filter?.cluster_id_pattern === "^4$"
    );
    expect(cl04Templates.length).toBeGreaterThan(0);
    expect(cl04Templates[0].text.length).toBeGreaterThan(30);
  });

  it("cl04 template text is not a placeholder id.url pattern", () => {
    const templates = extractAdTemplates(bundle);
    const cl04Templates = templates.filter(
      (t) => t.cluster_filter?.cluster_id_pattern === "^4$"
    );
    expect(cl04Templates.length).toBeGreaterThan(0);
    // Placeholder pattern: "<cluster_id>. <url>" e.g. "4. https://..."
    expect(cl04Templates[0].text).not.toMatch(/^4\.\s+https?:\/\//);
  });
});

// ---------------------------------------------------------------------------
// AC3: No extracted template title is a placeholder (cluster_id or bare number)
// ---------------------------------------------------------------------------
describe("AC3 — no placeholder titles across all groups", () => {
  it("every template title is a real string, not the cluster_id value", () => {
    const templates = extractAdTemplates(bundle);
    expect(templates.length).toBeGreaterThan(0);

    for (const t of templates) {
      // cluster_id values in the real bundle are "1", "4", "6" etc.
      // A title equal to just those is a placeholder
      expect(t.title).not.toMatch(/^\d+$/);
      // Title must also not be empty
      expect(t.title.length).toBeGreaterThan(0);
    }
  });

  it("every template title has length > 5 (real Russian ad text, not a placeholder id)", () => {
    const templates = extractAdTemplates(bundle);
    expect(templates.length).toBeGreaterThan(0);

    for (const t of templates) {
      expect(t.title.length).toBeGreaterThan(5);
    }
  });
});

// ---------------------------------------------------------------------------
// AC4: DailyBudget.Amount from _campaign.yaml → resolveDailyBudgetMicros
//       returns exact micros (no truncation)
// ---------------------------------------------------------------------------
describe("AC4 — resolveDailyBudgetMicros preserves exact micros from YAML Amount", () => {
  it("DailyBudget.Amount=8500000 (EUR) passes through as-is — no /1_000_000 truncation", () => {
    const yamlAmount = bundle.campaign.campaign.DailyBudget.Amount; // 8_500_000
    expect(yamlAmount).toBe(8_500_000);

    const micros = resolveDailyBudgetMicros({ daily_budget_amount: yamlAmount });
    expect(micros).toBe(8_500_000);
    // The old buggy approach would have returned 8 (Math.floor(8500000/1000000))
    expect(micros).not.toBe(8);
  });

  it("campaign currency from YAML is EUR (not RUB) — amount value is in micros already", () => {
    expect(bundle.campaign.campaign.DailyBudget.Currency).toBe("EUR");
  });
});

// ---------------------------------------------------------------------------
// AC8: resolveCampaignStrategy + findExistingCampaignId
// ---------------------------------------------------------------------------
describe("AC8 — single-campaign strategy returns campaign_name from YAML; dedupe finds existing Id", () => {
  it("resolveCampaignStrategy in single-campaign mode returns campaign.Name from YAML", () => {
    // Inject upload_strategy=single-campaign into the bundle's campaign object
    const bundleWithStrategy = {
      ...bundle,
      campaign: {
        ...bundle.campaign,
        upload_strategy: "single-campaign" as const,
      },
    };

    const strategy = resolveCampaignStrategy(bundleWithStrategy);
    expect(strategy.mode).toBe("single-campaign");
    // campaign_name must match the real Name from _campaign.yaml
    if (strategy.mode === "single-campaign") {
      expect(strategy.campaign_name).toBe("gce_search_5clusters_2026-05");
    }
  });

  it("findExistingCampaignId returns existing Id when list contains the campaign name", () => {
    const campaignName = bundle.campaign.campaign.Name; // "gce_search_5clusters_2026-05"
    const existingCampaigns = [
      { Id: 12345, Name: campaignName },
      { Id: 99999, Name: "other-campaign" },
    ];

    const found = findExistingCampaignId(existingCampaigns, campaignName);
    expect(found).toBe(12345);
  });

  it("findExistingCampaignId returns undefined when campaign name not in list", () => {
    const campaignName = bundle.campaign.campaign.Name;
    const existingCampaigns = [{ Id: 99999, Name: "different-campaign" }];

    const found = findExistingCampaignId(existingCampaigns, campaignName);
    expect(found).toBeUndefined();
  });

  it("default strategy from real bundle (no upload_strategy) is one-per-cluster", () => {
    const strategy = resolveCampaignStrategy(bundle);
    expect(strategy.mode).toBe("one-per-cluster");
  });
});

// ---------------------------------------------------------------------------
// Snapshot: extractAdTemplates(bundle) shape is stable
// ---------------------------------------------------------------------------
describe("Snapshot — extractAdTemplates(bundle) shape", () => {
  it("matches snapshot of real GCE bundle (3 groups = cl01 + cl04 + cl06)", () => {
    const templates = extractAdTemplates(bundle);
    expect(templates).toMatchSnapshot();
  });
});

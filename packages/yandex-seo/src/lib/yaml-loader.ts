import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import {
  CampaignSchema,
  GroupSchema,
  validateGroupAdCompatibility,
} from "./yaml-schema.js";

export interface LoadedCampaignBundle {
  campaign_dir: string;
  campaign: ReturnType<typeof CampaignSchema.parse>;
  groups: Array<ReturnType<typeof GroupSchema.parse>>;
  validation_errors: string[]; // empty if all OK
}

export function loadCampaignFolder(folder: string): LoadedCampaignBundle {
  // 1. Read _campaign.yaml
  const campaignPath = join(folder, "_campaign.yaml");
  const campaignRaw = yaml.load(readFileSync(campaignPath, "utf8"));
  const campaign = CampaignSchema.parse(campaignRaw);

  // 2. List group-*.yaml files, sort by name
  const files = readdirSync(folder)
    .filter((f) => f.startsWith("group-") && f.endsWith(".yaml"))
    .sort();

  // 3. Parse each
  const errors: string[] = [];
  const groups = files
    .map((f) => {
      try {
        const raw = yaml.load(readFileSync(join(folder, f), "utf8"));
        const g = GroupSchema.parse(raw);

        // 4. Validate Group.Type <-> Ad.Type compatibility
        for (const ad of g.ads) {
          if (!validateGroupAdCompatibility(g.group.Type, ad.Type)) {
            errors.push(
              `${f}: Ad.Type=${ad.Type} not compatible with Group.Type=${g.group.Type}`
            );
          }
        }
        return g;
      } catch (e: unknown) {
        errors.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  // 5. Multi-campaign consistency: when a `campaigns` map is declared, every
  //    group's `campaign` value must reference a key in that map (typo guard).
  const campaignKeys = campaign.campaigns ? Object.keys(campaign.campaigns) : null;
  if (campaignKeys) {
    for (const g of groups) {
      if (g.campaign && !campaignKeys.includes(g.campaign)) {
        errors.push(
          `group "${g.group.Name}": campaign "${g.campaign}" is not a key in the campaigns map (${campaignKeys.join(", ")})`
        );
      }
    }
  }

  return {
    campaign_dir: folder,
    campaign,
    groups,
    validation_errors: errors,
  };
}

// Helper: extract all refs from loaded bundle
// (used by upload pipeline to know what to create first)
export function collectRefs(bundle: LoadedCampaignBundle): {
  sitelinks: boolean;
  promo: boolean;
  images: string[];
} {
  return {
    sitelinks: !!bundle.campaign.sitelinks_set,
    promo: !!bundle.campaign.promo_extension,
    images: bundle.campaign.images ? Object.keys(bundle.campaign.images) : [],
  };
}

// Helper: resolve refs in the loaded bundle after entities created
export function resolveRefs(
  bundle: LoadedCampaignBundle,
  context: {
    sitelinks_set_id?: number;
    promo_extension_id?: number;
    image_hashes?: Record<string, string>;
  }
): LoadedCampaignBundle {
  let text = JSON.stringify(bundle);
  if (context.sitelinks_set_id) {
    text = text.replace(
      /"\$\{sitelinks_set\.Id\}"/g,
      String(context.sitelinks_set_id)
    );
  }
  if (context.promo_extension_id) {
    text = text.replace(
      /"\$\{promo_extension\.Id\}"/g,
      String(context.promo_extension_id)
    );
  }
  if (context.image_hashes) {
    for (const [name, hash] of Object.entries(context.image_hashes)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(
        new RegExp(`"\\$\\{image\\.${escaped}\\.Hash\\}"`, "g"),
        JSON.stringify(hash)
      );
    }
  }
  return JSON.parse(text) as LoadedCampaignBundle;
}

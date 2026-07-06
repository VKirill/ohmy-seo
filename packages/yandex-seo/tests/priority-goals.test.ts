import { describe, it, expect } from "vitest";

// payload-builder has no runtime deps that pull @ohmy-seo/mcp-core subpaths,
// so it can be imported directly (ESM, .js extension) without mocking.
import {
  buildUnifiedCampaignPayload,
  buildCampaignUpdatePayload,
} from "../src/lib/payload-builder.js";

/** Pull UnifiedCampaign.PriorityGoals.Items out of a build*Payload result. */
function priorityGoalsItems(
  payload:
    | ReturnType<typeof buildUnifiedCampaignPayload>
    | ReturnType<typeof buildCampaignUpdatePayload>,
): Array<Record<string, unknown>> {
  const campaign = payload.params.Campaigns[0] as Record<string, unknown>;
  const unified = campaign["UnifiedCampaign"] as Record<string, unknown>;
  const priorityGoals = unified["PriorityGoals"] as { Items: Array<Record<string, unknown>> };
  return priorityGoals.Items;
}

// ---------------------------------------------------------------------------
// CREATE — buildUnifiedCampaignPayload: PriorityGoals items carry NO Operation
// ---------------------------------------------------------------------------

describe("buildUnifiedCampaignPayload — per-goal conversion Value (CREATE, no Operation)", () => {
  it("priority_goals with a value → exact { GoalId, Value } (no Operation)", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "c",
      priority_goals: [{ goal_id: 100, value: 5_000_000 }],
    });
    const items = priorityGoalsItems(payload);
    expect(items).toEqual([{ GoalId: 100, Value: 5_000_000 }]);
    // Guard explicitly: CREATE items must not carry an Operation key.
    expect(items[0]).not.toHaveProperty("Operation");
  });

  it("priority_goals without a value → item is { GoalId } (no Value, no Operation)", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "c",
      priority_goals: [{ goal_id: 100 }],
    });
    const items = priorityGoalsItems(payload);
    expect(items).toEqual([{ GoalId: 100 }]);
    expect(items[0]).not.toHaveProperty("Value");
    expect(items[0]).not.toHaveProperty("Operation");
  });

  it("legacy goal_ids path (no priority_goals) → { GoalId, Value: 100 } (no Operation)", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "c",
      goal_ids: [9],
    });
    const items = priorityGoalsItems(payload);
    expect(items).toEqual([{ GoalId: 9, Value: 100 }]);
    expect(items[0]).not.toHaveProperty("Operation");
  });

  it("priority_goals takes precedence over goal_ids (uses goal 100, not 9)", () => {
    const payload = buildUnifiedCampaignPayload({
      name: "c",
      goal_ids: [9],
      priority_goals: [{ goal_id: 100, value: 200 }],
    });
    const items = priorityGoalsItems(payload);
    expect(items).toEqual([{ GoalId: 100, Value: 200 }]);
  });
});

// ---------------------------------------------------------------------------
// UPDATE — buildCampaignUpdatePayload: PriorityGoals items MUST carry Operation:"SET"
// ---------------------------------------------------------------------------

describe("buildCampaignUpdatePayload — per-goal conversion Value (UPDATE, Operation:'SET')", () => {
  it("priority_goals with a value → exact { GoalId, Operation:'SET', Value }", () => {
    const payload = buildCampaignUpdatePayload({
      campaign_id: 712,
      priority_goals: [{ goal_id: 100, value: 5_000_000 }],
    });
    const items = priorityGoalsItems(payload);
    expect(items).toEqual([{ GoalId: 100, Operation: "SET", Value: 5_000_000 }]);
  });

  it("priority_goals without a value → { GoalId, Operation:'SET' } (no Value)", () => {
    const payload = buildCampaignUpdatePayload({
      campaign_id: 712,
      priority_goals: [{ goal_id: 100 }],
    });
    const items = priorityGoalsItems(payload);
    expect(items).toEqual([{ GoalId: 100, Operation: "SET" }]);
    expect(items[0]).not.toHaveProperty("Value");
  });

  it("legacy goal_ids path → { GoalId, Operation:'SET', Value: 100 }", () => {
    const payload = buildCampaignUpdatePayload({
      campaign_id: 712,
      goal_ids: [9],
    });
    const items = priorityGoalsItems(payload);
    expect(items).toEqual([{ GoalId: 9, Operation: "SET", Value: 100 }]);
  });

  it("every UPDATE PriorityGoals item has Operation === 'SET' (guards live API rules)", () => {
    // Multi-goal, mixed value/no-value, across both the priority_goals path and
    // the legacy goal_ids path — no item may ever omit Operation on UPDATE.
    const fromPriorityGoals = priorityGoalsItems(
      buildCampaignUpdatePayload({
        campaign_id: 712,
        priority_goals: [{ goal_id: 100, value: 5_000_000 }, { goal_id: 200 }],
      }),
    );
    const fromLegacy = priorityGoalsItems(
      buildCampaignUpdatePayload({ campaign_id: 712, goal_ids: [9, 10] }),
    );
    for (const item of [...fromPriorityGoals, ...fromLegacy]) {
      expect(item["Operation"]).toBe("SET");
    }
  });

  it("no priority_goals and no goal_ids → no PriorityGoals key (and no UnifiedCampaign at all when it was the only unified field)", () => {
    const payload = buildCampaignUpdatePayload({ campaign_id: 712 });
    const campaign = payload.params.Campaigns[0] as Record<string, unknown>;
    // UnifiedCampaign is emitted only when it has at least one field; here it has none.
    expect(campaign).not.toHaveProperty("UnifiedCampaign");
  });

  it("no priority_goals/goal_ids but another unified field present → UnifiedCampaign exists WITHOUT PriorityGoals", () => {
    const payload = buildCampaignUpdatePayload({
      campaign_id: 712,
      counter_ids: [555],
    });
    const campaign = payload.params.Campaigns[0] as Record<string, unknown>;
    const unified = campaign["UnifiedCampaign"] as Record<string, unknown>;
    expect(unified).toBeDefined();
    expect(unified).not.toHaveProperty("PriorityGoals");
    // Sanity: the other unified field made it through.
    expect(unified["CounterIds"]).toEqual({ Items: [555] });
  });
});

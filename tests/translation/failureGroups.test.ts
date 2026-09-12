import { describe, expect, it } from "vitest";
import {
  buildFailureGroups,
  extendFailureGroupCooldown,
} from "../../lib/translation/failureGroups";
import { DIAGNOSTIC_TAXONOMY } from "../../lib/translation/diagnostics";

describe("stable translation failure groups", () => {
  it("keeps failures from one operation and cause in one stable group", () => {
    const failures = [
      {
        failureGroupId: "batch-7:QUOTA_EXHAUSTED",
        pageIndex: 1,
        diagnostic: DIAGNOSTIC_TAXONOMY.QUOTA_EXHAUSTED,
      },
      {
        failureGroupId: "batch-7:QUOTA_EXHAUSTED",
        pageIndex: 4,
        diagnostic: DIAGNOSTIC_TAXONOMY.QUOTA_EXHAUSTED,
      },
    ];

    expect(buildFailureGroups(failures, {}, 1_000)).toEqual([
      expect.objectContaining({
        id: "batch-7:QUOTA_EXHAUSTED",
        pages: [2, 5],
        pageIndices: [1, 4],
        diagnostic: DIAGNOSTIC_TAXONOMY.QUOTA_EXHAUSTED,
      }),
    ]);
  });

  it("keeps the concrete failure messages for diagnostics", () => {
    const failures = [
      {
        failureGroupId: "batch-7:PROVIDER_RESPONSE_INVALID",
        pageIndex: 1,
        diagnostic: DIAGNOSTIC_TAXONOMY.PROVIDER_RESPONSE_INVALID,
        message: "Translation response malformed: invalid JSON.",
      },
      {
        failureGroupId: "batch-7:PROVIDER_RESPONSE_INVALID",
        pageIndex: 4,
        diagnostic: DIAGNOSTIC_TAXONOMY.PROVIDER_RESPONSE_INVALID,
        message: "Translation retry response malformed: bubbles array missing.",
      },
    ];

    expect(buildFailureGroups(failures, {}, 1_000)[0].messages).toEqual([
      "Translation response malformed: invalid JSON.",
      "Translation retry response malformed: bubbles array missing.",
    ]);
  });

  it("does not merge a later operation into an older group with the same cause", () => {
    const failures = [
      {
        failureGroupId: "batch-7:NETWORK_OR_TIMEOUT",
        pageIndex: 0,
        diagnostic: DIAGNOSTIC_TAXONOMY.NETWORK_OR_TIMEOUT,
      },
      {
        failureGroupId: "batch-8:NETWORK_OR_TIMEOUT",
        pageIndex: 2,
        diagnostic: DIAGNOSTIC_TAXONOMY.NETWORK_OR_TIMEOUT,
      },
    ];

    const groups = buildFailureGroups(failures, {}, 1_000);
    expect(groups.map((group) => group.id)).toEqual([
      "batch-7:NETWORK_OR_TIMEOUT",
      "batch-8:NETWORK_OR_TIMEOUT",
    ]);
    expect(groups.map((group) => group.pages)).toEqual([[1], [3]]);
  });

  it("extends an active group cooldown but never shortens it", () => {
    const initial = { "batch-2:QUOTA_EXHAUSTED": 61_000 };

    expect(
      extendFailureGroupCooldown(initial, "batch-2:QUOTA_EXHAUSTED", 31_000),
    ).toEqual({ "batch-2:QUOTA_EXHAUSTED": 61_000 });
    expect(
      extendFailureGroupCooldown(initial, "batch-2:QUOTA_EXHAUSTED", 91_000),
    ).toEqual({ "batch-2:QUOTA_EXHAUSTED": 91_000 });
  });

  it("attaches quota cooldown only to its owning failure group", () => {
    const failures = [
      {
        failureGroupId: "batch-2:QUOTA_EXHAUSTED",
        pageIndex: 0,
        diagnostic: DIAGNOSTIC_TAXONOMY.QUOTA_EXHAUSTED,
      },
      {
        failureGroupId: "batch-2:NETWORK_OR_TIMEOUT",
        pageIndex: 1,
        diagnostic: DIAGNOSTIC_TAXONOMY.NETWORK_OR_TIMEOUT,
      },
    ];

    const groups = buildFailureGroups(
      failures,
      { "batch-2:QUOTA_EXHAUSTED": 61_000 },
      1_000,
    );

    expect(groups[0]).toMatchObject({
      cooldownUntil: 61_000,
      cooldownRemainingSeconds: 60,
    });
    expect(groups[1].cooldownUntil).toBeUndefined();
    expect(groups[1].cooldownRemainingSeconds).toBe(0);
  });
});

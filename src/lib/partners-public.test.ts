import { describe, expect, it } from "vitest";
import { buildPublicPartnerGroups } from "~/lib/partners-public-data";
import type { PartnerRecord } from "~/lib/pocketbase-types";

function partner(overrides: Partial<PartnerRecord>): PartnerRecord {
  return {
    id: "partner-1",
    name: "Partner",
    published: true,
    type: "supporter",
    logo: "logo.png",
    ...overrides,
  } as PartnerRecord;
}

describe("public partner groups", () => {
  it("groups multiple partners when the collection has no autodate fields", () => {
    const groups = buildPublicPartnerGroups([
      partner({ id: "game-of-codes", name: "Game of Codes", type: "company_supporter" }),
      partner({ id: "zurich-js", name: "ZurichJS", type: "supporter" }),
      partner({ id: "a11y-collective", name: "A11y Collective", type: "supporter" }),
    ]);

    expect(groups.find((group) => group.id === "supporters")?.partners.map((item) => item.name)).toEqual([
      "Game of Codes",
    ]);
    expect(groups.find((group) => group.id === "community-partners")?.partners.map((item) => item.name)).toEqual([
      "A11y Collective",
      "ZurichJS",
    ]);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { parseClosedCfpConfig } from "~/lib/cfp-config-preparation";

describe("closed CFP preparation configuration", () => {
  it("accepts only explicitly closed configuration with a valid optional date", () => {
    expect(parseClosedCfpConfig({ cfp_open: false, cfp_deadline: "2027-02-28" }))
      .toEqual({ cfp_open: false, cfp_deadline: "2027-02-28" });
    expect(parseClosedCfpConfig({ cfp_open: false, cfp_deadline: null }))
      .toEqual({ cfp_open: false, cfp_deadline: null });
  });

  it.each([
    { cfp_open: true, cfp_deadline: "2099-07-30" },
    { cfp_open: false, cfp_deadline: "2027-02-30" },
    { cfp_open: false, cfp_deadline: null, availability: { cfp: true } },
    { cfp_deadline: null },
  ])("rejects configuration that can open or mutate other activation state", (input) => {
    expect(() => parseClosedCfpConfig(input)).toThrow("Only valid closed CFP configuration can be prepared.");
  });
});

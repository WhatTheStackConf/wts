import { describe, expect, it } from "vitest";
import { cfpDeadlineTimestamp } from "~/lib/cfp-deadline";

describe("CFP deadline policy", () => {
  it.each([
    "2026-07-30",
    "2026-07-30T00:00:00.000Z",
    "2026-07-30 00:00:00.000Z",
  ])("treats the configured calendar date as inclusive: %s", (deadline) => {
    expect(new Date(cfpDeadlineTimestamp(deadline)).toISOString())
      .toBe("2026-07-30T23:59:59.999Z");
  });

  it("preserves explicit deadline times", () => {
    expect(new Date(cfpDeadlineTimestamp("2026-07-30T17:00:00.000Z")).toISOString())
      .toBe("2026-07-30T17:00:00.000Z");
  });
});

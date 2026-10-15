import { describe, expect, it } from "vite-plus/test";
import {
  CapabilityUnavailableError,
  capabilityUnavailableMetadata,
  isCapabilityAvailable,
} from "~/lib/capability-availability";
import { capabilityForPath } from "~/lib/conference-capability-policy";

describe("conference capability availability", () => {
  it("requires one complete configuration and denies missing or duplicate singletons", () => {
    expect(isCapabilityAvailable([], "cfp")).toBe(false);
    expect(isCapabilityAvailable([{ availability: { cfp: true, review: true }, cfp_open: true }, { availability: { cfp: true, review: true }, cfp_open: true }], "cfp")).toBe(false);
    expect(isCapabilityAvailable([{ availability: { cfp: true } , cfp_open: true }], "cfp")).toBe(false);
    expect(isCapabilityAvailable([{ availability: { cfp: "true", review: false }, cfp_open: true }], "cfp")).toBe(false);
    expect(isCapabilityAvailable([{ availability: { cfp: true, review: true } }], "review")).toBe(false);
  });

  it("activates only the explicitly enabled capability", () => {
    const records = [{ availability: { cfp: true, review: false }, cfp_open: true }];
    expect(isCapabilityAvailable(records, "cfp")).toBe(true);
    expect(isCapabilityAvailable(records, "review")).toBe(false);
    const closedRecords = [{ availability: { cfp: true, review: true }, cfp_open: false }];
    expect(isCapabilityAvailable(closedRecords, "cfp")).toBe(false);
    expect(isCapabilityAvailable(closedRecords, "review")).toBe(true);
  });
  it("maps protected route variants to one capability", () => {
    expect(capabilityForPath("/cfp")).toBe("cfp");
    expect(capabilityForPath("/cfp/closed/")).toBe("cfp");
    expect(capabilityForPath("/reviewer/weights/")).toBe("review");
    expect(capabilityForPath("/admin/weights/")).toBe("review");
    expect(capabilityForPath("/admin/users/")).toBeNull();
  });
  it("marks capability failures safe and preserves machine-readable metadata", () => {
    const error = new CapabilityUnavailableError("review");
    expect(error).toMatchObject({ status: 404, code: "capability_unavailable" });
    expect(Object.getOwnPropertyDescriptor(error, Symbol.for("solid.SafeError"))?.value).toBe(true);
    expect(capabilityUnavailableMetadata(error)).toEqual({
      status: 404,
      code: "capability_unavailable",
    });
    expect(capabilityUnavailableMetadata(new Error("other failure"))).toEqual({});
  });
});

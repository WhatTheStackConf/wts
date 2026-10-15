import { describe, expect, it } from "vite-plus/test";
import { isApproved2027Admin } from "~/lib/edition-admin";

describe("2027 CFP preparation authority", () => {
  it("requires both the current admin role and an explicit user-ID approval", () => {
    const approvedId = "approvedadmin01";
    expect(isApproved2027Admin(approvedId, "admin", approvedId)).toBe(true);
    expect(isApproved2027Admin(approvedId, "reviewer", approvedId)).toBe(false);
    expect(isApproved2027Admin("historicalstaff01", "admin", approvedId)).toBe(false);
    expect(isApproved2027Admin(approvedId, "admin", "")).toBe(false);
  });
});

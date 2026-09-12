import { describe, expect, it, vi } from "vite-plus/test";
import {
  adminAuthorized,
  authorizedResourceSource,
  checkinOperatorAuthorized,
  mcAuthorized,
  reviewerAuthorized,
} from "~/lib/route-authorization";

describe("privileged route authorization", () => {
  const roles = [undefined, "user", "reviewer", "checkin_operator", "mc", "admin"] as const;

  it("does not authorize or fetch while authentication is loading", () => {
    for (const role of roles) {
      const state = { loading: true, authenticated: role !== undefined, role };
      expect(adminAuthorized(state)).toBe(false);
      expect(reviewerAuthorized(state)).toBe(false);
      expect(checkinOperatorAuthorized(state)).toBe(false);
      expect(mcAuthorized(state)).toBe(false);
    }
    const fetcher = vi.fn();
    if (authorizedResourceSource(false)) fetcher();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("authorizes only operators and admins for /checkin without widening existing privileged routes", () => {
    for (const role of roles) {
      expect(checkinOperatorAuthorized({ loading: false, authenticated: false, role })).toBe(false);
      expect(checkinOperatorAuthorized({ loading: false, authenticated: true, role }))
        .toBe(role === "checkin_operator" || role === "admin");
    }
    const operator = { loading: false, authenticated: true, role: "checkin_operator" } as const;
    expect(adminAuthorized(operator)).toBe(false);
    expect(reviewerAuthorized(operator)).toBe(false);
  });

  it("authorizes only MCs and admins for Q&A moderation", () => {
    for (const role of roles) {
      expect(mcAuthorized({ loading: false, authenticated: false, role })).toBe(false);
      expect(mcAuthorized({ loading: false, authenticated: true, role })).toBe(role === "mc" || role === "admin");
    }
    const mc = { loading: false, authenticated: true, role: "mc" } as const;
    expect(adminAuthorized(mc)).toBe(false);
    expect(reviewerAuthorized(mc)).toBe(false);
    expect(checkinOperatorAuthorized(mc)).toBe(false);
  });

  it("authorizes only admins for admin routes", () => {
    expect(adminAuthorized({ loading: false, authenticated: false })).toBe(false);
    expect(adminAuthorized({ loading: false, authenticated: true, role: "user" })).toBe(false);
    expect(adminAuthorized({ loading: false, authenticated: true, role: "reviewer" })).toBe(false);
    expect(adminAuthorized({ loading: false, authenticated: true, role: "admin" })).toBe(true);
  });

  it("authorizes reviewers and admins for reviewer routes", () => {
    expect(reviewerAuthorized({ loading: false, authenticated: false })).toBe(false);
    expect(reviewerAuthorized({ loading: false, authenticated: true, role: "user" })).toBe(false);
    expect(reviewerAuthorized({ loading: false, authenticated: true, role: "reviewer" })).toBe(true);
    expect(reviewerAuthorized({ loading: false, authenticated: true, role: "admin" })).toBe(true);
    expect(authorizedResourceSource(true)).toBe(true);
  });
});

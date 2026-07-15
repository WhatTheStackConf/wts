import { describe, expect, it, vi } from "vitest";
import {
  adminAuthorized,
  authorizedResourceSource,
  reviewerAuthorized,
} from "~/lib/route-authorization";

describe("privileged route authorization", () => {
  const roles = [undefined, "user", "reviewer", "admin"] as const;

  it("does not authorize or fetch while authentication is loading", () => {
    for (const role of roles) {
      const state = { loading: true, authenticated: role !== undefined, role };
      expect(adminAuthorized(state)).toBe(false);
      expect(reviewerAuthorized(state)).toBe(false);
    }
    const fetcher = vi.fn();
    if (authorizedResourceSource(false)) fetcher();
    expect(fetcher).not.toHaveBeenCalled();
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

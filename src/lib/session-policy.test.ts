import { describe, expect, it } from "vitest";
import {
  hasManagedSessionCookie,
  isSameOriginMutation,
  legacyTokenFromStorage,
  serializeExpiredManagedSessionCookie,
  serializeExpiredSessionCookie,
  serializeManagedSessionCookie,
  serializeSessionCookie,
  tokenMaxAge,
} from "~/lib/session-policy";

function token(exp: number): string {
  return `header.${btoa(JSON.stringify({ exp }))}.signature`;
}

describe("session policy", () => {
  it("creates a bounded HttpOnly SameSite cookie and enables Secure when requested", () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    const cookie = serializeSessionCookie(token(now / 1000 + 30 * 24 * 60 * 60), true, now);
    expect(cookie).toContain("pb_auth=");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=604800");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain(encodeURIComponent('"record":null'));
    expect(serializeManagedSessionCookie(token(now / 1000 + 3600), true, now))
      .toContain("pb_auth_managed=1");
  });

  it("expires before the token and rejects malformed or expired tokens", () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(tokenMaxAge(token(now / 1000 + 3600), now)).toBe(3540);
    expect(tokenMaxAge("not-a-token", now)).toBe(0);
    expect(() => serializeSessionCookie("not-a-token", false, now)).toThrow("Unauthorized");
    expect(serializeExpiredSessionCookie(true)).toContain("Max-Age=0");
    expect(serializeExpiredSessionCookie(true)).toContain("HttpOnly");
    expect(serializeExpiredManagedSessionCookie(true)).toContain("Max-Age=0");
  });

  it("accepts only same-origin POST session mutations", () => {
    const headers = { origin: "https://wts.sh", host: "wts.sh", "sec-fetch-site": "same-origin" };
    expect(isSameOriginMutation(new Request("https://wts.sh/_server", { method: "POST", headers }))).toBe(true);
    expect(isSameOriginMutation(new Request("https://wts.sh/_server", { method: "GET", headers }))).toBe(false);
    expect(isSameOriginMutation(new Request("https://wts.sh/_server", {
      method: "POST",
      headers: { ...headers, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    }))).toBe(false);
  });

  it("extracts only a token from the legacy PocketBase storage shape", () => {
    expect(legacyTokenFromStorage(JSON.stringify({ token: "legacy-token", record: { role: "admin" } }))).toBe("legacy-token");
    expect(legacyTokenFromStorage(JSON.stringify({ record: { role: "admin" } }))).toBeNull();
    expect(legacyTokenFromStorage("broken")).toBeNull();
  });

  it("recognizes only the server-managed session marker", () => {
    expect(hasManagedSessionCookie("pb_auth=value; pb_auth_managed=1")).toBe(true);
    expect(hasManagedSessionCookie("pb_auth=value; pb_auth_managed=0")).toBe(false);
    expect(hasManagedSessionCookie("pb_auth=value")).toBe(false);
  });
});

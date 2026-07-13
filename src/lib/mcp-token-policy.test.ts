import { describe, expect, it } from "vitest";
import {
  maximumNewMcpTokenExpiryDate,
  normalizeNewMcpTokenExpiry,
} from "~/lib/mcp-token-policy";

const now = Date.parse("2026-07-13T12:00:00.000Z");

describe("new MCP token expiry policy", () => {
  it("exposes the same maximum date used by the token form", () => {
    expect(maximumNewMcpTokenExpiryDate(now)).toBe("2026-10-11");
  });

  it("defaults to an exact 90-day maximum", () => {
    expect(normalizeNewMcpTokenExpiry(undefined, now)).toEqual({
      success: true,
      expiresAt: "2026-10-11T12:00:00.000Z",
    });
  });

  it("accepts the 90th calendar day without issuing beyond the hard maximum", () => {
    expect(normalizeNewMcpTokenExpiry("2026-10-11", now)).toEqual({
      success: true,
      expiresAt: "2026-10-11T12:00:00.000Z",
    });
  });

  it("uses the end of an earlier selected UTC day", () => {
    expect(normalizeNewMcpTokenExpiry("2026-07-14", now)).toEqual({
      success: true,
      expiresAt: "2026-07-14T23:59:59.999Z",
    });
  });

  it("rejects malformed, past, and more-than-90-day dates", () => {
    expect(normalizeNewMcpTokenExpiry("not-a-date", now)).toEqual({
      success: false,
      reason: "invalid",
    });
    expect(normalizeNewMcpTokenExpiry("2026-07-12", now)).toEqual({
      success: false,
      reason: "past",
    });
    expect(normalizeNewMcpTokenExpiry("2026-10-12", now)).toEqual({
      success: false,
      reason: "too_long",
    });
  });
});

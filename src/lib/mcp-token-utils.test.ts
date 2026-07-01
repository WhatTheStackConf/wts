import { describe, expect, it } from "vitest";
import {
  createMcpTokenMaterial,
  hashMcpTokenSecret,
  parseMcpToken,
  verifyMcpTokenSecret,
} from "~/lib/mcp-token-utils";

describe("MCP token utilities", () => {
  it("creates a one-time token whose secret can be verified from the stored hash", () => {
    const material = createMcpTokenMaterial();
    const parsed = parseMcpToken(material.token);

    expect(parsed).not.toBeNull();
    expect(parsed?.tokenId).toBe(material.tokenId);
    expect(material.secretHash).toBe(hashMcpTokenSecret(parsed!.secret));
    expect(verifyMcpTokenSecret(parsed!.secret, material.secretHash)).toBe(true);
  });

  it("rejects malformed tokens and incorrect secrets", () => {
    const material = createMcpTokenMaterial();
    const parsed = parseMcpToken(material.token);

    expect(parsed).not.toBeNull();
    expect(parseMcpToken("pb_auth_not-an-mcp-token")).toBeNull();
    expect(verifyMcpTokenSecret(`${parsed!.secret}x`, material.secretHash)).toBe(false);
  });
});

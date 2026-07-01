import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MCP_TOKEN_PREFIX = "wts_mcp";
const TOKEN_ID_BYTES = 12;
const TOKEN_SECRET_BYTES = 32;
const TOKEN_ID_PATTERN = /^[a-f0-9]{24}$/;
const TOKEN_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const TOKEN_PATTERN = /^wts_mcp_([a-f0-9]{24})_([A-Za-z0-9_-]{32,})$/;

export type McpTokenMaterial = {
  token: string;
  tokenId: string;
  tokenPrefix: string;
  secretHash: string;
};

export type ParsedMcpToken = {
  tokenId: string;
  secret: string;
};

export function hashMcpTokenSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifyMcpTokenSecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashMcpTokenSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function parseMcpToken(token: string): ParsedMcpToken | null {
  const match = TOKEN_PATTERN.exec(token.trim());
  if (!match) return null;

  const tokenId = match[1];
  const secret = match[2];
  if (!TOKEN_ID_PATTERN.test(tokenId) || !TOKEN_SECRET_PATTERN.test(secret)) {
    return null;
  }

  return { tokenId, secret };
}

export function createMcpTokenMaterial(): McpTokenMaterial {
  const tokenId = randomBytes(TOKEN_ID_BYTES).toString("hex");
  const secret = randomBytes(TOKEN_SECRET_BYTES).toString("base64url");
  const token = `${MCP_TOKEN_PREFIX}_${tokenId}_${secret}`;

  return {
    token,
    tokenId,
    tokenPrefix: `${MCP_TOKEN_PREFIX}_${tokenId.slice(0, 8)}`,
    secretHash: hashMcpTokenSecret(secret),
  };
}

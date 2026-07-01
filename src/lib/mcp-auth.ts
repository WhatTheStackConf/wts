import { getAdminPB } from "~/lib/pocketbase-admin-service";
import type { McpTokenRecord } from "~/lib/pocketbase-types";
import { parseMcpToken, verifyMcpTokenSecret } from "~/lib/mcp-token-utils";

export const MCP_SCOPES = ["program:read"] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export type AuthenticatedMcpToken = {
  id: string;
  name: string;
  tokenId: string;
  createdBy: string;
  scopes: McpScope[];
  expiresAt?: string;
};

export type McpAuthResult =
  | { success: true; token: AuthenticatedMcpToken }
  | { success: false; status: 401 | 403; error: string };

export function normalizeMcpScopes(value: unknown): McpScope[] {
  if (!Array.isArray(value)) return [];
  return value.filter((scope): scope is McpScope =>
    MCP_SCOPES.includes(scope as McpScope),
  );
}

export function hasMcpScope(token: AuthenticatedMcpToken, scope: McpScope) {
  return token.scopes.includes(scope);
}

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function isPastDate(value?: string): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

export async function authenticateMcpBearer(
  authorization: string | null,
): Promise<McpAuthResult> {
  const rawToken = extractBearerToken(authorization);
  if (!rawToken) {
    return { success: false, status: 401, error: "Missing MCP bearer token" };
  }

  const parsed = parseMcpToken(rawToken);
  if (!parsed) {
    return { success: false, status: 401, error: "Invalid MCP bearer token" };
  }

  const adminService = getAdminPB();
  const records = (await adminService.fetchAllRecords("mcp_tokens", {
    filter: `token_id = "${parsed.tokenId}"`,
  })) as McpTokenRecord[];

  const record = records[0];
  if (!record || !verifyMcpTokenSecret(parsed.secret, record.secret_hash)) {
    return { success: false, status: 401, error: "Invalid MCP bearer token" };
  }

  if (record.revoked_at) {
    return { success: false, status: 403, error: "MCP token has been revoked" };
  }

  if (isPastDate(record.expires_at)) {
    return { success: false, status: 403, error: "MCP token has expired" };
  }

  const scopes = normalizeMcpScopes(record.scopes);
  await adminService.updateRecord("mcp_tokens", record.id, {
    last_used_at: new Date().toISOString(),
  });

  return {
    success: true,
    token: {
      id: record.id,
      name: record.name,
      tokenId: record.token_id,
      createdBy: record.created_by,
      scopes,
      expiresAt: record.expires_at,
    },
  };
}

import { getAdminPB } from "~/lib/pocketbase-admin-service";
import type { McpTokenRecord, UserRecord } from "~/lib/pocketbase-types";
import { parseMcpToken, verifyMcpTokenSecret } from "~/lib/mcp-token-utils";

export const MCP_SCOPES = [
  "programme:read",
  "cfp:read",
  "partners:read",
  "partners:draft:write",
] as const;

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
  return MCP_SCOPES.filter((scope) => value.includes(scope));
}

function expandLegacyMcpScopes(value: unknown): unknown {
  if (!Array.isArray(value) || !value.includes("program:read")) return value;
  return [...new Set(value.flatMap((scope) =>
    scope === "program:read" ? ["programme:read", "cfp:read"] : [scope]
  ))];
}

export function hasMcpScope(token: AuthenticatedMcpToken, scope: McpScope) {
  return token.scopes.includes(scope);
}

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(authorization.trim());
  return match?.[1] || null;
}

function expiryState(value?: string): "active" | "expired" | "invalid" {
  if (!value) return "active";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "invalid";
  return timestamp <= Date.now() ? "expired" : "active";
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
    return { success: false, status: 401, error: "MCP token has been revoked" };
  }

  const expiry = expiryState(record.expires_at);
  if (expiry === "expired") {
    return { success: false, status: 401, error: "MCP token has expired" };
  }
  if (expiry === "invalid") {
    return { success: false, status: 401, error: "MCP token expiry is invalid" };
  }

  const owners = (await adminService.fetchAllRecords("users", {
    filter: `id = "${record.created_by}"`,
  })) as UserRecord[];
  if (owners[0]?.role !== "admin") {
    return {
      success: false,
      status: 403,
      error: "MCP token owner is not a current admin",
    };
  }

  const persistedScopes = expandLegacyMcpScopes(record.scopes);
  const scopes = normalizeMcpScopes(persistedScopes);
  await adminService.updateRecord("mcp_tokens", record.id, {
    ...(persistedScopes !== record.scopes ? { scopes: persistedScopes } : {}),
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

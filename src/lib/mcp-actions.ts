import { requireAdmin } from "~/lib/server-auth";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import type { McpTokenRecord } from "~/lib/pocketbase-types";
import { createMcpTokenMaterial } from "~/lib/mcp-token-utils";
import { MCP_SCOPES, type McpScope, normalizeMcpScopes } from "~/lib/mcp-auth";
import { normalizeNewMcpTokenExpiry } from "~/lib/mcp-token-policy";

export type McpTokenInput = {
  name: string;
  scopes: McpScope[];
  expires_at?: string | null;
};

export type McpTokenSnapshot = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: McpScope[];
  created_by: string;
  expires_at?: string;
  revoked_at?: string;
  revoked_by?: string;
  last_used_at?: string;
};

function pbMcpErrorMessage(error: unknown): string {
  const response = (error as { response?: { data?: Record<string, { message?: string }> } })
    ?.response;
  const data = response?.data;
  if (data && typeof data === "object") {
    const parts = Object.entries(data)
      .map(([field, detail]) => {
        const message =
          detail && typeof detail === "object" && "message" in detail
            ? String(detail.message)
            : JSON.stringify(detail);
        return `${field}: ${message}`;
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("; ");
  }
  if (error instanceof Error && error.message) return error.message;
  return "Request failed";
}

function tokenSnapshot(record: McpTokenRecord): McpTokenSnapshot {
  return {
    id: record.id,
    name: record.name,
    token_prefix: record.token_prefix,
    scopes: normalizeMcpScopes(record.scopes),
    created_by: record.created_by,
    expires_at: record.expires_at,
    revoked_at: record.revoked_at,
    revoked_by: record.revoked_by,
    last_used_at: record.last_used_at,
  };
}

export const adminFetchMcpTokens = async () => {
  "use server";
  try {
    const user = await requireAdmin();
    const adminService = getAdminPB();
    const records = (await adminService.fetchAllRecords("mcp_tokens", {
      filter: `created_by = "${user.id}"`,
      sort: "name",
    })) as McpTokenRecord[];
    return { success: true, data: records.map(tokenSnapshot) };
  } catch (error) {
    console.error("Admin fetch MCP tokens error:", error);
    return { success: false, error: pbMcpErrorMessage(error) };
  }
};

export const adminCreateMcpToken = async (input: McpTokenInput) => {
  "use server";
  try {
    const user = await requireAdmin();
    const name = input.name?.trim();
    if (!name) return { success: false, error: "Token name is required." };

    const scopes = normalizeMcpScopes(input.scopes);
    if (scopes.length === 0) {
      return { success: false, error: "Choose at least one MCP scope." };
    }

    const unknownScope = input.scopes.find((scope) => !MCP_SCOPES.includes(scope));
    if (unknownScope) return { success: false, error: "Choose a valid MCP scope." };

    const expiry = normalizeNewMcpTokenExpiry(input.expires_at);
    if (!expiry.success) {
      return {
        success: false,
        error:
          expiry.reason === "too_long"
            ? "Token expiry cannot be more than 90 days away."
            : "Choose a future expiry date.",
      };
    }

    const material = createMcpTokenMaterial();
    const adminService = getAdminPB();
    const record = (await adminService.createRecord("mcp_tokens", {
      name,
      token_id: material.tokenId,
      token_prefix: material.tokenPrefix,
      secret_hash: material.secretHash,
      scopes,
      created_by: user.id,
      expires_at: expiry.expiresAt,
    })) as McpTokenRecord;

    return {
      success: true,
      token: material.token,
      data: tokenSnapshot(record),
    };
  } catch (error) {
    console.error("Admin create MCP token error:", error);
    return { success: false, error: pbMcpErrorMessage(error) };
  }
};

export const adminRevokeMcpToken = async (id: string) => {
  "use server";
  try {
    const user = await requireAdmin();
    if (!id?.trim()) return { success: false, error: "Choose a token to revoke." };

    const adminService = getAdminPB();
    const existing = (await adminService.fetchRecordById("mcp_tokens", id)) as McpTokenRecord;
    if (existing.created_by !== user.id) {
      return { success: false, error: "You can only revoke your own MCP tokens." };
    }

    const record = (await adminService.updateRecord("mcp_tokens", id, {
      revoked_at: new Date().toISOString(),
      revoked_by: user.id,
    })) as McpTokenRecord;
    return { success: true, data: tokenSnapshot(record) };
  } catch (error) {
    console.error("Admin revoke MCP token error:", error);
    return { success: false, error: pbMcpErrorMessage(error) };
  }
};

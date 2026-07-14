import { requireAdmin } from "~/lib/server-auth";
import { AdminActions } from "~/lib/admin-action-ledger";
import { createPocketBaseAdminActionStore } from "~/lib/admin-action-store";
import {
  McpTokenAdministration,
  type McpActivityFilters,
  type McpTokenCreateRequest,
  type McpTokenSnapshot,
} from "~/lib/mcp-token-administration";
import { createPocketBaseMcpTokenAdministrationStore } from "~/lib/mcp-token-administration-store";

export type McpTokenInput = McpTokenCreateRequest;
export type { McpActivityFilters, McpTokenSnapshot };

function administration(user: { id: string; name?: string }): McpTokenAdministration {
  return new McpTokenAdministration(
    createPocketBaseMcpTokenAdministrationStore(),
    { userId: user.id, name: user.name || "Unknown User" },
    new AdminActions(createPocketBaseAdminActionStore()),
  );
}

function actionFailure(error: unknown) {
  const value = error as { name?: string; status?: number };
  console.error(JSON.stringify({
    event: "mcp_token_administration_failed",
    status: Number.isFinite(value?.status) ? value.status : undefined,
    errorType: value?.name || (error instanceof Error ? error.name : "UnknownError"),
  }));
  return {
    success: false as const,
    code: "infrastructure" as const,
    error: "MCP token request failed.",
  };
}

export const adminFetchMcpTokens = async () => {
  "use server";
  try {
    const user = await requireAdmin();
    return { success: true as const, data: await administration(user).listTokens() };
  } catch (error) {
    return actionFailure(error);
  }
};

export const adminFetchMcpActivity = async (filters: McpActivityFilters = {}) => {
  "use server";
  try {
    const user = await requireAdmin();
    return { success: true as const, data: await administration(user).listActivity(filters) };
  } catch (error) {
    return actionFailure(error);
  }
};

export const adminCreateMcpToken = async (
  operationId: string,
  input: McpTokenInput,
) => {
  "use server";
  try {
    const user = await requireAdmin();
    return await administration(user).createToken(input, operationId);
  } catch (error) {
    return actionFailure(error);
  }
};

export const adminRevokeMcpToken = async (
  operationId: string,
  id: string,
  reason: string,
) => {
  "use server";
  try {
    const user = await requireAdmin();
    return await administration(user).revokeToken(id, reason, operationId);
  } catch (error) {
    return actionFailure(error);
  }
};

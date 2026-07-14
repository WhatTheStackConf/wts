import type PocketBase from "pocketbase";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import type { McpTokenRecord, UserRecord } from "~/lib/pocketbase-types";
import { normalizeMcpScopes } from "~/lib/mcp-auth";
import type {
  McpTokenAdministrationStore,
  McpTokenAdministrationUser,
  McpTokenStoredRecord,
  McpTokenStoreAdminAction,
} from "~/lib/mcp-token-administration";

const MCP_TOKENS_COLLECTION = "mcp_tokens";
const MCP_TOKEN_MUTATION_ROUTE = "/api/wts/mcp-tokens";

function storedToken(record: McpTokenRecord): McpTokenStoredRecord {
  return {
    id: record.id,
    name: record.name,
    tokenPrefix: record.token_prefix,
    scopes: normalizeMcpScopes(record.scopes),
    ownerUserId: record.created_by,
    expiresAt: record.expires_at,
    revokedAt: record.revoked_at,
    revokedByUserId: record.revoked_by,
    revocationReason: record.revocation_reason,
    lastUsedAt: record.last_used_at,
    createdAt: record.created,
    updatedAt: record.updated,
  };
}

function administrationUser(record: Pick<UserRecord, "id" | "name" | "role">): McpTokenAdministrationUser {
  return { id: record.id, name: record.name || "Unknown User", role: record.role };
}

function appendAdminAction(
  body: Record<string, unknown>,
  adminAction: McpTokenStoreAdminAction,
): Record<string, unknown> {
  return {
    ...body,
    admin_action_id: adminAction.handle.actionId,
    admin_action_attempt_token: adminAction.handle.attemptToken,
    admin_action_operation_kind: adminAction.operationKind,
    admin_action_normalized_input: JSON.stringify(adminAction.normalizedInput),
  };
}

function isNotFound(error: unknown): boolean {
  return (error as { status?: number })?.status === 404;
}

export function createPocketBaseMcpTokenAdministrationStore(
  client?: PocketBase,
): McpTokenAdministrationStore {
  const pocketBase = async () => client || getAdminPB().getInstance();
  return {
    async list() {
      const pb = await pocketBase();
      const records = await pb.collection(MCP_TOKENS_COLLECTION).getFullList<McpTokenRecord>({
        sort: "name,id",
      });
      return records.map(storedToken);
    },
    async listUsers() {
      const pb = await pocketBase();
      const records = await pb.collection("users").getFullList<UserRecord>({
        fields: "id,name,role",
        sort: "name,id",
      });
      return records.map(administrationUser);
    },
    async get(id) {
      const pb = await pocketBase();
      try {
        return storedToken(await pb.collection(MCP_TOKENS_COLLECTION).getOne<McpTokenRecord>(id));
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async create(input, adminAction) {
      const pb = await pocketBase();
      const record = await pb.send<McpTokenRecord>(MCP_TOKEN_MUTATION_ROUTE, {
        method: "POST",
        body: appendAdminAction({
          id: input.id,
          name: input.name,
          token_id: input.tokenId,
          token_prefix: input.tokenPrefix,
          secret_hash: input.secretHash,
          scopes: input.scopes,
          created_by: input.ownerUserId,
          expires_at: input.expiresAt,
        }, adminAction),
      });
      return storedToken(record);
    },
    async revoke(id, input, adminAction) {
      const pb = await pocketBase();
      const record = await pb.send<McpTokenRecord>(
        `${MCP_TOKEN_MUTATION_ROUTE}/${encodeURIComponent(id)}/revoke`,
        {
          method: "POST",
          body: appendAdminAction({
            revoked_at: input.revokedAt,
            revocation_reason: input.reason,
          }, adminAction),
        },
      );
      return storedToken(record);
    },
  };
}

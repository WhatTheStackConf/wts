import type {
  McpTokenAdministrationStore,
  McpTokenAdministrationUser,
  McpTokenStoredRecord,
} from "~/lib/mcp-token-administration";

interface McpTokenAdministrationMemorySeed {
  users?: McpTokenAdministrationUser[];
  tokens?: McpTokenStoredRecord[];
}

export function createInMemoryMcpTokenAdministrationStore(
  seed: McpTokenAdministrationMemorySeed = {},
): McpTokenAdministrationStore {
  const users = structuredClone(seed.users || []);
  const tokens = structuredClone(seed.tokens || []);
  return {
    async list() {
      return structuredClone(tokens);
    },
    async listUsers() {
      return structuredClone(users);
    },
    async get(id) {
      const token = tokens.find((candidate) => candidate.id === id);
      return token ? structuredClone(token) : undefined;
    },
    async create(input, adminAction) {
      if (tokens.some((candidate) => candidate.id === input.id)) {
        throw new Error("MCP token already exists.");
      }
      const record: McpTokenStoredRecord = {
        id: input.id,
        name: input.name,
        tokenPrefix: input.tokenPrefix,
        scopes: [...input.scopes],
        ownerUserId: input.ownerUserId,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      tokens.push(record);
      try {
        await adminAction.complete(adminAction.completion);
      } catch (error) {
        if (!(await adminAction.isApplied())) tokens.splice(tokens.indexOf(record), 1);
        throw error;
      }
      return structuredClone(record);
    },
    async revoke(id, input, adminAction) {
      const index = tokens.findIndex((candidate) => candidate.id === id);
      if (index < 0) throw new Error("MCP token was not found.");
      if (tokens[index].revokedAt) throw new Error("MCP token is already revoked.");
      const current = tokens[index];
      const updated = {
        ...current,
        revokedAt: input.revokedAt,
        revokedByUserId: input.revokedByUserId,
        revocationReason: input.reason,
        updatedAt: input.revokedAt,
      };
      tokens[index] = updated;
      try {
        await adminAction.complete(adminAction.completion);
      } catch (error) {
        if (!(await adminAction.isApplied())) tokens[index] = current;
        throw error;
      }
      return structuredClone(updated);
    },
  };
}

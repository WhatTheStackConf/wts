import type {
  AdminActionCompletion,
  AdminActionHandle,
  AdminActionRecord,
  AdminActionValue,
  AdminActionStatus,
} from "~/lib/admin-action-ledger";
import type { AdminActions } from "~/lib/admin-action-ledger";
import { MCP_SCOPES, normalizeMcpScopes, type McpScope } from "~/lib/mcp-auth";
import { normalizeNewMcpTokenExpiry } from "~/lib/mcp-token-policy";
import { createMcpTokenMaterial } from "~/lib/mcp-token-utils";
import { randomUUID } from "node:crypto";

export type McpTokenStatus = "active" | "expired" | "revoked" | "owner_disabled";

export interface McpTokenOwner {
  id: string;
  name: string;
}

export interface McpTokenAdministrationActor {
  userId: string;
  name: string;
}

export interface McpTokenAdministrationUser extends McpTokenOwner {
  role: "user" | "reviewer" | "admin";
}

export interface McpTokenStoredRecord {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: McpScope[];
  ownerUserId: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedByUserId?: string;
  revocationReason?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpTokenSnapshot {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: McpScope[];
  owner: McpTokenOwner;
  status: McpTokenStatus;
  expiresAt?: string;
  revokedAt?: string;
  revokedBy?: McpTokenOwner;
  revocationReason?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpActivityFilters {
  tokenId?: string;
  ownerUserId?: string;
  statuses?: AdminActionStatus[];
  operationKind?: string;
  targetCollection?: string;
  targetId?: string;
}

export interface McpActivityItem {
  id: string;
  actor: McpTokenOwner;
  token?: McpTokenSnapshot;
  owner: McpTokenOwner;
  source: "admin_ui" | "mcp";
  operationKind: string;
  targetCollection: string;
  targetId?: string;
  operationId: string;
  status: AdminActionStatus;
  revocationReason?: string;
  failure?: { code: string; message: string };
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface McpTokenAdministrationStore {
  list(): Promise<McpTokenStoredRecord[]>;
  listUsers(): Promise<McpTokenAdministrationUser[]>;
  get(id: string): Promise<McpTokenStoredRecord | undefined>;
  create(
    input: McpTokenStoreCreateInput,
    adminAction: McpTokenStoreAdminAction,
  ): Promise<McpTokenStoredRecord>;
  revoke(
    id: string,
    input: McpTokenStoreRevokeInput,
    adminAction: McpTokenStoreAdminAction,
  ): Promise<McpTokenStoredRecord>;
}

export interface McpTokenCreateRequest {
  name: string;
  scopes: readonly McpScope[];
  expires_at?: string | null;
}

export interface McpTokenStoreCreateInput {
  id: string;
  name: string;
  tokenId: string;
  tokenPrefix: string;
  secretHash: string;
  scopes: McpScope[];
  ownerUserId: string;
  expiresAt: string;
  createdAt: string;
}

export interface McpTokenStoreRevokeInput {
  revokedByUserId: string;
  revokedAt: string;
  reason: string;
}

export interface McpTokenStoreAdminAction {
  handle: AdminActionHandle;
  operationKind: string;
  targetId?: string;
  normalizedInput: AdminActionValue;
  completion: AdminActionCompletion;
  complete(completion: AdminActionCompletion): Promise<AdminActionRecord>;
  isApplied(): Promise<boolean>;
}

export interface McpTokenOperationAction {
  id: string;
  operationId: string;
  operationKind: string;
  status: "applied" | "pending" | "failed";
  replayed: boolean;
}

export type McpTokenAdministrationResult<T> =
  | { success: true; data: T; action: McpTokenOperationAction }
  | {
      success: false;
      code:
        | "validation"
        | "not_found"
        | "not_active"
        | "operation_pending"
        | "operation_mismatch"
        | "operation_failed";
      error: string;
      action?: Omit<McpTokenOperationAction, "replayed">;
    };

interface McpTokenAdministrationOptions {
  now?: () => Date;
}

function statusFor(
  token: McpTokenStoredRecord,
  owner: McpTokenAdministrationUser | undefined,
  now: number,
): McpTokenStatus {
  if (token.revokedAt) return "revoked";
  const expiry = token.expiresAt ? Date.parse(token.expiresAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(expiry) || expiry <= now) return "expired";
  if (owner?.role !== "admin") return "owner_disabled";
  return "active";
}

function ownerSnapshot(
  id: string,
  users: Map<string, McpTokenAdministrationUser>,
): McpTokenOwner {
  const user = users.get(id);
  return { id, name: safeDisplayText(user?.name, "Unknown User", "Redacted User name") };
}

function safeTokenSummary(
  token: McpTokenStoredRecord,
  status: McpTokenStatus = token.revokedAt ? "revoked" : "active",
): AdminActionValue {
  return {
    id: token.id,
    name: safeDisplayText(token.name, "Unnamed token", "Redacted token name"),
    ownerUserId: token.ownerUserId,
    tokenPrefix: safeTokenPrefix(token.tokenPrefix),
    scopes: token.scopes,
    expiresAt: token.expiresAt || null,
    status,
    lastUsedAt: token.lastUsedAt || null,
    createdByUserId: token.ownerUserId,
    revokedAt: token.revokedAt || null,
    revokedByUserId: token.revokedByUserId || null,
    revocationReason: token.revocationReason || null,
  };
}

function operationAction(action: AdminActionRecord, replayed: boolean): McpTokenOperationAction {
  return {
    id: action.id,
    operationId: action.operationId,
    operationKind: action.operationKind,
    status: action.status,
    replayed,
  };
}

function unresolvedAction(action: AdminActionRecord) {
  return {
    id: action.id,
    operationId: action.operationId,
    operationKind: action.operationKind,
    status: action.status,
  };
}

function containsSecretMaterial(value: string): boolean {
  return /wts_mcp_[a-f0-9]{24}_[a-z0-9_-]{20,}/i.test(value) ||
    /(^|[^a-f0-9])[a-f0-9]{64}([^a-f0-9]|$)/i.test(value);
}

function safeDisplayText(
  value: string | undefined,
  fallback: string,
  redacted: string,
): string {
  const text = value?.trim() || "";
  if (!text) return fallback;
  return containsSecretMaterial(text) ? redacted : text;
}

function safeTokenPrefix(value: string): string {
  return /^wts_mcp_[a-f0-9]{8}$/i.test(value) ? value : "Redacted token prefix";
}

function safeRevocationReason(value: AdminActionValue): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const reason = value.revocationReason;
  if (typeof reason !== "string" || !reason || containsSecretMaterial(reason)) return undefined;
  return reason;
}

function actionValue(value: unknown): AdminActionValue {
  return JSON.parse(JSON.stringify(value)) as AdminActionValue;
}

function newRecordId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 15);
}

export class McpTokenAdministration {
  private readonly now: () => Date;

  constructor(
    private readonly store: McpTokenAdministrationStore,
    private readonly actor: McpTokenAdministrationActor,
    private readonly adminActions: AdminActions,
    options: McpTokenAdministrationOptions = {},
  ) {
    this.now = options.now || (() => new Date());
  }

  async listTokens(): Promise<McpTokenSnapshot[]> {
    const [tokens, userRecords] = await Promise.all([this.store.list(), this.store.listUsers()]);
    const users = new Map(userRecords.map((user) => [user.id, user]));
    return tokens
      .map((token) => this.snapshot(token, users))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  async listActivity(filters: McpActivityFilters = {}): Promise<McpActivityItem[]> {
    const [tokenActions, initiatedActions, tokens, userRecords] = await Promise.all([
      this.adminActions.list({ targetCollection: "mcp_tokens", limit: 200 }),
      this.adminActions.list({ sources: ["mcp"], limit: 200 }),
      this.store.list(),
      this.store.listUsers(),
    ]);
    const actions = [...new Map([...tokenActions, ...initiatedActions].map((action) => [action.id, action]))
      .values()]
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      )
      .slice(0, 200);
    const users = new Map(userRecords.map((user) => [user.id, user]));
    const tokenRecords = new Map(tokens.map((token) => [token.id, token]));
    const items = actions
      .filter((action) => action.source === "mcp" || action.targetCollection === "mcp_tokens")
      .map((action): McpActivityItem => {
        const tokenId = action.targetCollection === "mcp_tokens"
          ? action.targetId
          : action.mcpTokenId;
        const tokenRecord = tokenId ? tokenRecords.get(tokenId) : undefined;
        const ownerUserId = tokenRecord?.ownerUserId || action.actorUserId;
        return {
          id: action.id,
          actor: ownerSnapshot(action.actorUserId, users),
          token: tokenRecord ? this.snapshot(tokenRecord, users) : undefined,
          owner: ownerSnapshot(ownerUserId, users),
          source: action.source,
          operationKind: action.operationKind,
          targetCollection: action.targetCollection,
          targetId: action.targetId,
          operationId: safeDisplayText(
            action.operationId,
            "Unknown operation ID",
            "Redacted operation ID",
          ),
          status: action.status,
          revocationReason: safeRevocationReason(action.afterSummary),
          failure: action.failure
            ? { code: action.failure.code, message: action.failure.message }
            : undefined,
          attemptCount: action.attemptCount,
          createdAt: action.createdAt,
          updatedAt: action.updatedAt,
        };
      });
    return items.filter((item) =>
      (!filters.tokenId || item.token?.id === filters.tokenId) &&
      (!filters.ownerUserId || item.owner.id === filters.ownerUserId) &&
      (!filters.statuses?.length || filters.statuses.includes(item.status)) &&
      (!filters.operationKind || item.operationKind === filters.operationKind) &&
      (!filters.targetCollection || item.targetCollection === filters.targetCollection) &&
      (!filters.targetId || item.targetId === filters.targetId)
    );
  }

  async createToken(
    input: McpTokenCreateRequest,
    operationId: string,
  ): Promise<McpTokenAdministrationResult<{
    token: McpTokenSnapshot;
    credentialAvailable: boolean;
    credential?: string;
  }>> {
    const name = input.name?.trim();
    if (!name || name.length > 120) {
      return {
        success: false,
        code: "validation",
        error: "Token name must be between 1 and 120 characters.",
      };
    }
    if (containsSecretMaterial(name)) {
      return {
        success: false,
        code: "validation",
        error: "Token name cannot contain MCP credential or hash material.",
      };
    }
    if (!Array.isArray(input.scopes) || input.scopes.some((scope) => !MCP_SCOPES.includes(scope))) {
      return { success: false, code: "validation", error: "Choose valid MCP scopes." };
    }
    const scopes = normalizeMcpScopes(input.scopes);
    if (scopes.length === 0) {
      return { success: false, code: "validation", error: "Choose at least one MCP scope." };
    }
    if (
      !operationId?.trim() || operationId.trim() !== operationId || operationId.length > 128 ||
      containsSecretMaterial(operationId)
    ) {
      return { success: false, code: "validation", error: "Choose a valid operation ID." };
    }
    const expiresOn = input.expires_at?.trim() || null;
    const request = {
      actorUserId: this.actor.userId,
      source: "admin_ui" as const,
      operationKind: "mcp_token.create",
      targetCollection: "mcp_tokens",
      operationId,
      normalizedInput: { name, scopes, expiresOn },
    };
    const existing = await this.adminActions.inspect(request);
    if (existing.outcome === "replayed") return this.replayCreate(existing.action);
    if (existing.outcome === "pending") {
      return {
        success: false,
        code: "operation_pending",
        error: "This MCP token operation is already in progress.",
        action: unresolvedAction(existing.action),
      };
    }
    if (existing.outcome === "mismatch") {
      return {
        success: false,
        code: "operation_mismatch",
        error: "This operation ID is already bound to different MCP token input.",
        action: unresolvedAction(existing.action),
      };
    }

    const expiry = normalizeNewMcpTokenExpiry(expiresOn, this.now().getTime());
    if (!expiry.success) {
      return {
        success: false,
        code: "validation",
        error:
          expiry.reason === "too_long"
            ? "Token expiry cannot be more than 90 days away."
            : "Choose a future expiry date.",
      };
    }
    const userRecords = await this.store.listUsers();
    const users = new Map(userRecords.map((user) => [user.id, user]));
    const material = createMcpTokenMaterial();
    const createdAt = this.now().toISOString();
    const candidate: McpTokenStoredRecord = {
      id: newRecordId(),
      name,
      tokenPrefix: material.tokenPrefix,
      scopes,
      ownerUserId: this.actor.userId,
      expiresAt: expiry.expiresAt,
      createdAt,
      updatedAt: createdAt,
    };
    const completion: AdminActionCompletion = {
      targetId: candidate.id,
      beforeSummary: null,
      afterSummary: safeTokenSummary(candidate),
      replayResult: {
        kind: "mcp_token_create",
        data: {
          token: actionValue(this.snapshot(candidate, users)),
          credentialAvailable: false,
        },
      },
    };
    const started = await this.adminActions.start(request, {
      beforeSummary: null,
      afterSummary: {
        name,
        ownerUserId: this.actor.userId,
        scopes,
        expiresOn,
        createdByUserId: this.actor.userId,
        status: "pending",
      },
    });
    if (started.outcome === "replayed") return this.replayCreate(started.action);
    if (started.outcome === "pending") {
      return {
        success: false,
        code: "operation_pending",
        error: "This MCP token operation is already in progress.",
        action: unresolvedAction(started.action),
      };
    }
    if (started.outcome === "mismatch") {
      return {
        success: false,
        code: "operation_mismatch",
        error: "This operation ID is already bound to different MCP token input.",
        action: unresolvedAction(started.action),
      };
    }

    const adminAction: McpTokenStoreAdminAction = {
      handle: started.handle,
      operationKind: request.operationKind,
      normalizedInput: request.normalizedInput,
      completion,
      complete: (value) => this.adminActions.complete(started.handle, value),
      isApplied: async () => {
        const result = await this.adminActions.inspect(request);
        return result.outcome === "replayed" && result.action.targetId === candidate.id;
      },
    };
    try {
      await this.store.create({
        id: candidate.id,
        name,
        tokenId: material.tokenId,
        tokenPrefix: material.tokenPrefix,
        secretHash: material.secretHash,
        scopes,
        ownerUserId: this.actor.userId,
        expiresAt: expiry.expiresAt,
        createdAt,
      }, adminAction);
      const inspected = await this.adminActions.inspect(request);
      if (inspected.outcome !== "replayed") {
        throw new Error("MCP token create returned before its Admin Action was applied.");
      }
      const replayed = this.replayCreate(inspected.action, false);
      if (!replayed.success) return replayed;
      return {
        ...replayed,
        data: {
          ...replayed.data,
          credentialAvailable: true,
          credential: material.token,
        },
      };
    } catch {
      const inspected = await this.adminActions.inspect(request);
      if (inspected.outcome === "replayed") {
        if (inspected.action.targetId !== candidate.id) return this.replayCreate(inspected.action);
        const committed = this.replayCreate(inspected.action, false);
        if (!committed.success) return committed;
        return {
          ...committed,
          data: {
            ...committed.data,
            credentialAvailable: true,
            credential: material.token,
          },
        };
      }
      let failed = inspected.outcome === "new" ? undefined : inspected.action;
      try {
        failed = await this.adminActions.fail(started.handle, {
          code: "mcp_token_write_failed",
          message: "MCP token persistence failed safely.",
          metadata: { retryable: true },
        });
      } catch {
        // The unresolved pending action remains visible for recovery.
      }
      return {
        success: false,
        code: "operation_failed",
        error: "The MCP token operation failed safely and may be retried with the same operation ID.",
        action: failed ? unresolvedAction(failed) : undefined,
      };
    }
  }

  async revokeToken(
    idValue: string,
    reasonValue: string,
    operationId: string,
  ): Promise<McpTokenAdministrationResult<{ token: McpTokenSnapshot }>> {
    const id = idValue?.trim();
    const reason = reasonValue?.trim();
    if (!id || id.length > 128) {
      return { success: false, code: "validation", error: "Choose a valid MCP token." };
    }
    if (!reason || reason.length > 500) {
      return {
        success: false,
        code: "validation",
        error: "Revocation reason must be between 1 and 500 characters.",
      };
    }
    if (containsSecretMaterial(reason)) {
      return {
        success: false,
        code: "validation",
        error: "Revocation reason cannot contain MCP credential or hash material.",
      };
    }
    if (
      !operationId?.trim() || operationId.trim() !== operationId || operationId.length > 128 ||
      containsSecretMaterial(operationId)
    ) {
      return { success: false, code: "validation", error: "Choose a valid operation ID." };
    }

    const request = {
      actorUserId: this.actor.userId,
      source: "admin_ui" as const,
      operationKind: "mcp_token.revoke",
      targetCollection: "mcp_tokens",
      targetId: id,
      operationId,
      normalizedInput: { id, reason },
    };
    const existing = await this.adminActions.inspect(request);
    if (existing.outcome === "replayed") return this.replay(existing.action);
    if (existing.outcome === "pending") {
      return {
        success: false,
        code: "operation_pending",
        error: "This MCP token operation is already in progress.",
        action: unresolvedAction(existing.action),
      };
    }
    if (existing.outcome === "mismatch") {
      return {
        success: false,
        code: "operation_mismatch",
        error: "This operation ID is already bound to different MCP token input.",
        action: unresolvedAction(existing.action),
      };
    }

    const [token, userRecords] = await Promise.all([this.store.get(id), this.store.listUsers()]);
    if (!token) return { success: false, code: "not_found", error: "MCP token was not found." };
    const users = new Map(userRecords.map((user) => [user.id, user]));
    const currentStatus = statusFor(token, users.get(token.ownerUserId), this.now().getTime());
    if (currentStatus === "revoked") {
      return {
        success: false,
        code: "not_active",
        error: "This MCP token is already revoked.",
      };
    }

    const revokedAt = this.now().toISOString();
    const candidate: McpTokenStoredRecord = {
      ...token,
      revokedAt,
      revokedByUserId: this.actor.userId,
      revocationReason: reason,
      updatedAt: revokedAt,
    };
    const completion: AdminActionCompletion = {
      targetId: id,
      beforeSummary: safeTokenSummary(token, currentStatus),
      afterSummary: safeTokenSummary(candidate),
      replayResult: {
        kind: "mcp_token_revoke",
        data: { token: actionValue(this.snapshot(candidate, users)) },
      },
    };
    const started = await this.adminActions.start(request, completion);
    if (started.outcome === "replayed") return this.replay(started.action);
    if (started.outcome === "pending") {
      return {
        success: false,
        code: "operation_pending",
        error: "This MCP token operation is already in progress.",
        action: unresolvedAction(started.action),
      };
    }
    if (started.outcome === "mismatch") {
      return {
        success: false,
        code: "operation_mismatch",
        error: "This operation ID is already bound to different MCP token input.",
        action: unresolvedAction(started.action),
      };
    }

    const adminAction: McpTokenStoreAdminAction = {
      handle: started.handle,
      operationKind: request.operationKind,
      targetId: id,
      normalizedInput: request.normalizedInput,
      completion,
      complete: (value) => this.adminActions.complete(started.handle, value),
      isApplied: async () => (await this.adminActions.inspect(request)).outcome === "replayed",
    };
    try {
      const record = await this.store.revoke(id, {
        revokedByUserId: this.actor.userId,
        revokedAt,
        reason,
      }, adminAction);
      const inspected = await this.adminActions.inspect(request);
      if (inspected.outcome === "replayed") {
        return this.replay(inspected.action, false);
      }
      throw new Error(`MCP token revoke returned before its Admin Action was applied: ${record.id}`);
    } catch {
      const inspected = await this.adminActions.inspect(request);
      if (inspected.outcome === "replayed") return this.replay(inspected.action);
      let failed = inspected.outcome === "new" ? undefined : inspected.action;
      try {
        failed = await this.adminActions.fail(started.handle, {
          code: "mcp_token_write_failed",
          message: "MCP token persistence failed safely.",
          metadata: { retryable: true },
        });
      } catch {
        // The unresolved pending action remains visible for recovery.
      }
      return {
        success: false,
        code: "operation_failed",
        error: "The MCP token operation failed safely and may be retried with the same operation ID.",
        action: failed ? unresolvedAction(failed) : undefined,
      };
    }
  }

  private snapshot(
    token: McpTokenStoredRecord,
    users: Map<string, McpTokenAdministrationUser>,
  ): McpTokenSnapshot {
    return {
      id: token.id,
      name: safeDisplayText(token.name, "Unnamed token", "Redacted token name"),
      tokenPrefix: safeTokenPrefix(token.tokenPrefix),
      scopes: [...token.scopes],
      owner: ownerSnapshot(token.ownerUserId, users),
      status: statusFor(token, users.get(token.ownerUserId), this.now().getTime()),
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
      revokedBy: token.revokedByUserId ? ownerSnapshot(token.revokedByUserId, users) : undefined,
      revocationReason: token.revocationReason,
      lastUsedAt: token.lastUsedAt,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };
  }

  private replay(
    action: AdminActionRecord,
    replayed = true,
  ): McpTokenAdministrationResult<{ token: McpTokenSnapshot }> {
    const replayResult = action.replayResult;
    if (
      replayResult &&
      typeof replayResult === "object" &&
      !Array.isArray(replayResult) &&
      replayResult.data &&
      typeof replayResult.data === "object" &&
      !Array.isArray(replayResult.data) &&
      replayResult.data.token &&
      typeof replayResult.data.token === "object" &&
      !Array.isArray(replayResult.data.token)
    ) {
      return {
        success: true,
        data: { token: replayResult.data.token as unknown as McpTokenSnapshot },
        action: operationAction(action, replayed),
      };
    }
    return {
      success: false,
      code: "operation_failed",
      error: "The applied MCP token operation has no replayable result.",
      action: unresolvedAction(action),
    };
  }

  private replayCreate(
    action: AdminActionRecord,
    replayed = true,
  ): McpTokenAdministrationResult<{
    token: McpTokenSnapshot;
    credentialAvailable: boolean;
    credential?: string;
  }> {
    const replayResult = action.replayResult;
    if (
      replayResult &&
      typeof replayResult === "object" &&
      !Array.isArray(replayResult) &&
      replayResult.data &&
      typeof replayResult.data === "object" &&
      !Array.isArray(replayResult.data) &&
      replayResult.data.token &&
      typeof replayResult.data.token === "object" &&
      !Array.isArray(replayResult.data.token)
    ) {
      return {
        success: true,
        data: {
          token: replayResult.data.token as unknown as McpTokenSnapshot,
          credentialAvailable: false,
        },
        action: operationAction(action, replayed),
      };
    }
    return {
      success: false,
      code: "operation_failed",
      error: "The applied MCP token operation has no replayable result.",
      action: unresolvedAction(action),
    };
  }
}

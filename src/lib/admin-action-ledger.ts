import { createHash, randomUUID } from "node:crypto";

export type AdminActionSource = "admin_ui" | "mcp";
export type AdminActionStatus = "pending" | "applied" | "failed";
const ADMIN_ACTION_REPLAY_MAX_BYTES = 32_768;
export type AdminActionValue =
  | null
  | boolean
  | number
  | string
  | AdminActionValue[]
  | { [key: string]: AdminActionValue };

export interface AdminActionRequest {
  actorUserId: string;
  mcpTokenId?: string;
  source: AdminActionSource;
  operationKind: string;
  targetCollection: string;
  targetId?: string;
  operationId: string;
  normalizedInput: AdminActionValue;
}

export interface AdminActionRecord {
  id: string;
  actorUserId: string;
  mcpTokenId?: string;
  source: AdminActionSource;
  operationKind: string;
  targetCollection: string;
  targetId?: string;
  operationId: string;
  inputFingerprint: string;
  status: AdminActionStatus;
  beforeSummary: AdminActionValue;
  afterSummary: AdminActionValue;
  replayResult: AdminActionValue;
  failure?: { code: string; message: string; metadata?: AdminActionValue };
  attemptCount: number;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminActionHandle {
  actionId: string;
  attemptToken: string;
}

interface AdminActionReservation {
  request: Omit<AdminActionRequest, "normalizedInput">;
  idempotencyKey: string;
  inputFingerprint: string;
  beforeSummary: AdminActionValue;
  afterSummary: AdminActionValue;
  attemptToken: string;
  now: string;
  leaseExpiresAt: string;
}

interface AdminActionIdentity {
  idempotencyKey: string;
  inputFingerprint: string;
  now: string;
}

export type AdminActionInspection =
  | { outcome: "new" }
  | { outcome: "replayed"; action: AdminActionRecord; result: AdminActionValue }
  | { outcome: "pending"; action: AdminActionRecord }
  | { outcome: "retryable"; action: AdminActionRecord }
  | { outcome: "mismatch"; action: AdminActionRecord };

export type AdminActionStoreStartResult =
  | { outcome: "started"; action: AdminActionRecord; handle: AdminActionHandle }
  | { outcome: "replayed"; action: AdminActionRecord }
  | { outcome: "pending"; action: AdminActionRecord }
  | { outcome: "mismatch"; action: AdminActionRecord };

export interface AdminActionCompletion {
  targetId?: string;
  beforeSummary: AdminActionValue;
  afterSummary: AdminActionValue;
  replayResult: AdminActionValue;
}

export type AdminActionPendingSummary = Pick<
  AdminActionCompletion,
  "beforeSummary" | "afterSummary"
>;

export interface AdminActionFailure {
  code: string;
  message: string;
  metadata?: AdminActionValue;
}

export interface AdminActionListQuery {
  targetCollection: string;
  targetId?: string;
  statuses?: AdminActionStatus[];
  limit?: number;
}

export interface AdminActionStore {
  inspect(input: AdminActionIdentity): Promise<AdminActionInspection>;
  reserve(input: AdminActionReservation): Promise<AdminActionStoreStartResult>;
  complete(
    handle: AdminActionHandle,
    completion: AdminActionCompletion,
    now: string,
  ): Promise<AdminActionRecord>;
  fail(
    handle: AdminActionHandle,
    failure: AdminActionFailure,
    now: string,
  ): Promise<AdminActionRecord>;
  list(query: Required<Pick<AdminActionListQuery, "targetCollection" | "limit">> &
    Omit<AdminActionListQuery, "targetCollection" | "limit">): Promise<AdminActionRecord[]>;
}

export type AdminActionStartResult =
  | Extract<AdminActionStoreStartResult, { outcome: "started" | "pending" | "mismatch" }>
  | { outcome: "replayed"; action: AdminActionRecord; result: AdminActionValue };

interface AdminActionsOptions {
  now?: () => Date;
  createAttemptToken?: () => string;
  leaseMilliseconds?: number;
}

function canonicalJson(value: AdminActionValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function fingerprint(value: AdminActionValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function actionIdentity(request: AdminActionRequest, now: string): AdminActionIdentity {
  return {
    idempotencyKey: fingerprint({
      actorUserId: request.actorUserId,
      mcpTokenId: request.mcpTokenId || null,
      source: request.source,
      operationKind: request.operationKind,
      operationId: request.operationId,
    }),
    inputFingerprint: fingerprint({
      targetCollection: request.targetCollection,
      targetId: request.targetId || null,
      normalizedInput: request.normalizedInput,
    }),
    now,
  };
}

function assertIdentifier(value: string | undefined, label: string, maximumLength = 128): void {
  if (value === undefined) return;
  if (!value || value.trim() !== value || value.length > maximumLength) {
    throw new Error(`${label} must be a trimmed value between 1 and ${maximumLength} characters.`);
  }
}

function assertFiniteValues(value: AdminActionValue): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Admin Action normalized input contains a non-finite number.");
  }
  if (Array.isArray(value)) {
    for (const item of value) assertFiniteValues(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value)) assertFiniteValues(item);
}

function assertRequest(request: AdminActionRequest): void {
  assertIdentifier(request.actorUserId, "Admin Action actor User ID");
  assertIdentifier(request.mcpTokenId, "Admin Action MCP token ID");
  assertIdentifier(request.operationKind, "Admin Action operation kind");
  assertIdentifier(request.targetCollection, "Admin Action target collection");
  assertIdentifier(request.targetId, "Admin Action target ID");
  assertIdentifier(request.operationId, "Admin Action operation ID");
  if (request.source !== "admin_ui" && request.source !== "mcp") {
    throw new Error("Admin Action source must be admin_ui or mcp.");
  }
  assertFiniteValues(request.normalizedInput);
  if (Buffer.byteLength(canonicalJson(request.normalizedInput), "utf8") > 32_768) {
    throw new Error("Admin Action normalized input must be 32,768 bytes or smaller.");
  }
}

const SENSITIVE_SUMMARY_FIELDS = new Set([
  "accesstoken",
  "authorization",
  "bearertoken",
  "clientsecret",
  "notes",
  "password",
  "payload",
  "rawbody",
  "rawrequest",
  "refreshtoken",
  "requestbody",
  "secret",
  "secrethash",
]);

const SAFE_NOTE_METADATA_FIELDS = new Set([
  "noteagentvisible",
  "notechanged",
  "notelength",
  "notepresent",
]);

function isSensitiveSummaryField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_SUMMARY_FIELDS.has(normalized) ||
    (normalized.includes("note") && !SAFE_NOTE_METADATA_FIELDS.has(normalized));
}

function assertSafeValue(
  value: AdminActionValue,
  label: string,
  maximumBytes: number,
  depth = 0,
): void {
  if (Buffer.byteLength(canonicalJson(value), "utf8") > maximumBytes) {
    throw new Error(`${label} must be ${maximumBytes.toLocaleString("en-US")} bytes or smaller.`);
  }
  if (depth > 6) throw new Error(`${label} is too deeply nested.`);
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${label} contains a non-finite number.`);
  }
  if (Array.isArray(value)) {
    if (value.length > 50) throw new Error(`${label} contains too many values.`);
    for (const item of value) assertSafeValue(item, label, maximumBytes, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const entries = Object.entries(value);
  if (entries.length > 50) throw new Error(`${label} contains too many fields.`);
  for (const [key, item] of entries) {
    if (isSensitiveSummaryField(key)) {
      throw new Error(`${label} contains the sensitive field "${key}".`);
    }
    assertSafeValue(item, label, maximumBytes, depth + 1);
  }
}

export class AdminActions {
  private readonly now: () => Date;
  private readonly createAttemptToken: () => string;
  private readonly leaseMilliseconds: number;

  constructor(
    private readonly store: AdminActionStore,
    options: AdminActionsOptions = {},
  ) {
    this.now = options.now || (() => new Date());
    this.createAttemptToken = options.createAttemptToken || randomUUID;
    this.leaseMilliseconds = options.leaseMilliseconds ?? 30_000;
  }

  async start(
    request: AdminActionRequest,
    pendingSummary?: AdminActionPendingSummary,
  ): Promise<AdminActionStartResult> {
    assertRequest(request);
    const beforeSummary = pendingSummary?.beforeSummary ?? null;
    const afterSummary = pendingSummary?.afterSummary ?? null;
    assertSafeValue(beforeSummary, "Admin Action before summary", 2_048);
    assertSafeValue(afterSummary, "Admin Action after summary", 2_048);
    const now = this.now();
    const identity = actionIdentity(request, now.toISOString());
    const result = await this.store.reserve({
      request: {
        actorUserId: request.actorUserId,
        mcpTokenId: request.mcpTokenId,
        source: request.source,
        operationKind: request.operationKind,
        targetCollection: request.targetCollection,
        targetId: request.targetId,
        operationId: request.operationId,
      },
      idempotencyKey: identity.idempotencyKey,
      inputFingerprint: identity.inputFingerprint,
      beforeSummary,
      afterSummary,
      attemptToken: this.createAttemptToken(),
      now: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + this.leaseMilliseconds).toISOString(),
    });
    return result.outcome === "replayed"
      ? { ...result, result: result.action.replayResult }
      : result;
  }

  async inspect(request: AdminActionRequest): Promise<AdminActionInspection> {
    assertRequest(request);
    return this.store.inspect(actionIdentity(request, this.now().toISOString()));
  }

  async complete(
    handle: AdminActionHandle,
    completion: AdminActionCompletion,
  ): Promise<AdminActionRecord> {
    assertSafeValue(completion.beforeSummary, "Admin Action before summary", 2_048);
    assertSafeValue(completion.afterSummary, "Admin Action after summary", 2_048);
    assertSafeValue(
      completion.replayResult,
      "Admin Action replay result",
      ADMIN_ACTION_REPLAY_MAX_BYTES,
    );
    return this.store.complete(handle, completion, this.now().toISOString());
  }

  async fail(handle: AdminActionHandle, failure: AdminActionFailure): Promise<AdminActionRecord> {
    if (!failure.code.trim() || failure.code.length > 64) {
      throw new Error("Admin Action failure code must be between 1 and 64 characters.");
    }
    if (!failure.message.trim() || Buffer.byteLength(failure.message, "utf8") > 256) {
      throw new Error("Admin Action failure message must be between 1 and 256 bytes.");
    }
    if (failure.metadata !== undefined) {
      assertSafeValue(failure.metadata, "Admin Action failure metadata", 1_024);
    }
    return this.store.fail(handle, failure, this.now().toISOString());
  }

  async list(query: AdminActionListQuery): Promise<AdminActionRecord[]> {
    return this.store.list({
      ...query,
      limit: Math.max(1, Math.min(Math.floor(query.limit ?? 50), 200)),
    });
  }
}

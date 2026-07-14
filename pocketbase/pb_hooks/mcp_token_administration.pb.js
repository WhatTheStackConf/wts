/// <reference path="../pb_data/types.d.ts" />

// PocketBase serializes route callbacks without outer lexical helpers.
routerAdd("POST", "/api/wts/mcp-tokens", (e) => {
  function parseJson(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  }
  function canonicalJson(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  function response(record) {
    return {
      id: record.id, name: record.getString("name"), token_prefix: record.getString("token_prefix"),
      scopes: record.get("scopes"), created_by: record.getString("created_by"),
      expires_at: record.getString("expires_at"), revoked_at: record.getString("revoked_at"),
      revoked_by: record.getString("revoked_by"), revocation_reason: record.getString("revocation_reason"),
      last_used_at: record.getString("last_used_at"), created: record.getString("created"),
      updated: record.getString("updated"),
    };
  }
  function hasBearerMaterial(value) {
    const text = String(value || "");
    return /wts_mcp_[a-f0-9]{24}_[a-z0-9_-]{20,}/i.test(text) ||
      /(^|[^a-f0-9])[a-f0-9]{64}([^a-f0-9]|$)/i.test(text);
  }
  function safeText(value, fallback, redacted) {
    const text = String(value || "").trim();
    if (!text) return fallback;
    return hasBearerMaterial(text) ? redacted : text;
  }
  function safePrefix(value) {
    const text = String(value || "");
    return /^wts_mcp_[a-f0-9]{8}$/i.test(text) ? text : "Redacted token prefix";
  }
  function assertSafePayload(value, label, maximumBytes) {
    if (toBytes(JSON.stringify(value)).length > maximumBytes) throw new BadRequestError(`${label} is too large.`);
    const blocked = ["accesstoken", "authorization", "bearertoken", "clientsecret", "password", "payload", "rawbody", "rawrequest", "refreshtoken", "requestbody", "secret", "secrethash", "tokenid"];
    function visit(item, depth) {
      if (depth > 6) throw new BadRequestError(`${label} is too deeply nested.`);
      if (typeof item === "string" && hasBearerMaterial(item)) throw new BadRequestError(`${label} contains bearer material.`);
      if (!item || typeof item !== "object") return;
      if (Array.isArray(item)) {
        if (item.length > 50) throw new BadRequestError(`${label} contains too many values.`);
        for (const child of item) visit(child, depth + 1);
        return;
      }
      const keys = Object.keys(item);
      if (keys.length > 50) throw new BadRequestError(`${label} contains too many fields.`);
      for (const key of keys) {
        if (blocked.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
          throw new BadRequestError(`${label} contains a sensitive field.`);
        }
        visit(item[key], depth + 1);
      }
    }
    visit(value, 0);
  }
  function owner(txApp, id) {
    const user = txApp.findRecordById("users", id);
    return { id: user.id, name: safeText(user.getString("name"), "Unknown User", "Redacted User name") };
  }
  function snapshot(txApp, record) {
    return {
      id: record.id, name: safeText(record.getString("name"), "Unnamed token", "Redacted token name"), tokenPrefix: safePrefix(record.getString("token_prefix")),
      scopes: record.get("scopes") || [], owner: owner(txApp, record.getString("created_by")),
      status: "active", expiresAt: record.getString("expires_at"), createdAt: record.getString("created"),
      updatedAt: record.getString("updated"),
    };
  }
  function summary(record) {
    return {
      id: record.id, name: safeText(record.getString("name"), "Unnamed token", "Redacted token name"), ownerUserId: record.getString("created_by"),
      tokenPrefix: safePrefix(record.getString("token_prefix")), scopes: record.get("scopes") || [],
      expiresAt: record.getString("expires_at") || null, status: "active", lastUsedAt: null,
      createdByUserId: record.getString("created_by"), revokedAt: null, revokedByUserId: null,
      revocationReason: null,
    };
  }
  const request = e.requestInfo();
  const body = request.body;
  const normalizedInput = parseJson(body.admin_action_normalized_input, null);
  if (!normalizedInput || typeof normalizedInput !== "object" || Array.isArray(normalizedInput)) {
    throw new BadRequestError("MCP token create input is invalid.");
  }
  const name = String(body.name || "").trim();
  const tokenId = String(body.token_id || "");
  const tokenPrefix = String(body.token_prefix || "");
  const secretHash = String(body.secret_hash || "");
  const scopes = parseJson(body.scopes, []);
  const expiresAt = String(body.expires_at || "");
  if (
    !name || name.length > 120 || hasBearerMaterial(name) || name !== String(normalizedInput.name || "") ||
    !Array.isArray(scopes) || JSON.stringify(scopes) !== JSON.stringify(normalizedInput.scopes || []) ||
    !/^[a-f0-9]{24}$/.test(tokenId) || tokenPrefix !== `wts_mcp_${tokenId.slice(0, 8)}` ||
    !/^[a-f0-9]{64}$/.test(secretHash) || String(body.created_by || "") === "" ||
    !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now() ||
    Date.parse(expiresAt) > Date.now() + 90 * 24 * 60 * 60 * 1000 + 60 * 1000 ||
    (normalizedInput.expiresOn && !expiresAt.startsWith(`${normalizedInput.expiresOn}T`))
  ) {
    throw new BadRequestError("MCP token create body does not match its reserved input.");
  }
  let result;
  $app.runInTransaction((txApp) => {
    const action = txApp.findRecordById("admin_actions", String(body.admin_action_id || ""));
    const expectedFingerprint = $security.sha256(canonicalJson({
      targetCollection: "mcp_tokens", targetId: null, normalizedInput,
    }));
    if (
      action.getString("status") !== "pending" ||
      action.getString("attempt_token") !== String(body.admin_action_attempt_token || "") ||
      action.getString("target_collection") !== "mcp_tokens" ||
      action.getString("operation_kind") !== "mcp_token.create" ||
      action.getString("operation_kind") !== String(body.admin_action_operation_kind || "") ||
      action.getString("target_id") || action.getString("input_fingerprint") !== expectedFingerprint ||
      action.getString("actor_user") !== String(body.created_by || "")
    ) {
      throw new BadRequestError("MCP token Admin Action attempt is no longer active.");
    }
    const actor = txApp.findRecordById("users", action.getString("actor_user"));
    if (actor.getString("role") !== "admin") throw new ForbiddenError("Current admin access is required.");
    const record = new Record(txApp.findCollectionByNameOrId("mcp_tokens"));
    const form = new RecordUpsertForm(txApp, record);
    form.grantSuperuserAccess();
    form.load({
      id: String(body.id || ""), name, token_id: tokenId, token_prefix: tokenPrefix,
      secret_hash: secretHash, scopes, created_by: action.getString("actor_user"), expires_at: expiresAt,
    });
    form.submit();
    const afterSummary = summary(record);
    const replayResult = { kind: "mcp_token_create", data: { token: snapshot(txApp, record), credentialAvailable: false } };
    assertSafePayload(afterSummary, "MCP token Admin Action summary", 2048);
    assertSafePayload(replayResult, "MCP token Admin Action replay result", 32768);
    action.set("target_id", record.id);
    action.set("status", "applied");
    action.set("before_summary", null);
    action.set("after_summary", afterSummary);
    action.set("replay_result", replayResult);
    action.set("lease_expires_at", "");
    action.set("completed_at", new Date().toISOString());
    txApp.save(action);
    result = response(record);
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

routerAdd("POST", "/api/wts/mcp-tokens/{id}/revoke", (e) => {
  function parseJson(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  }
  function canonicalJson(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  function response(record) {
    return {
      id: record.id, name: record.getString("name"), token_prefix: record.getString("token_prefix"),
      scopes: record.get("scopes"), created_by: record.getString("created_by"),
      expires_at: record.getString("expires_at"), revoked_at: record.getString("revoked_at"),
      revoked_by: record.getString("revoked_by"), revocation_reason: record.getString("revocation_reason"),
      last_used_at: record.getString("last_used_at"), created: record.getString("created"),
      updated: record.getString("updated"),
    };
  }
  function hasBearerMaterial(value) {
    const text = String(value || "");
    return /wts_mcp_[a-f0-9]{24}_[a-z0-9_-]{20,}/i.test(text) ||
      /(^|[^a-f0-9])[a-f0-9]{64}([^a-f0-9]|$)/i.test(text);
  }
  function safeText(value, fallback, redacted) {
    const text = String(value || "").trim();
    if (!text) return fallback;
    return hasBearerMaterial(text) ? redacted : text;
  }
  function safePrefix(value) {
    const text = String(value || "");
    return /^wts_mcp_[a-f0-9]{8}$/i.test(text) ? text : "Redacted token prefix";
  }
  function userSnapshot(txApp, id) {
    const user = txApp.findRecordById("users", id);
    return { id: user.id, name: safeText(user.getString("name"), "Unknown User", "Redacted User name") };
  }
  function summary(record, status, reason) {
    return {
      id: record.id, name: safeText(record.getString("name"), "Unnamed token", "Redacted token name"), ownerUserId: record.getString("created_by"),
      tokenPrefix: safePrefix(record.getString("token_prefix")), scopes: record.get("scopes") || [],
      expiresAt: record.getString("expires_at") || null, status,
      lastUsedAt: record.getString("last_used_at") || null,
      createdByUserId: record.getString("created_by"),
      revokedAt: record.getString("revoked_at") || null,
      revokedByUserId: record.getString("revoked_by") || null,
      revocationReason: reason || null,
    };
  }
  function snapshot(txApp, record) {
    const value = {
      id: record.id, name: safeText(record.getString("name"), "Unnamed token", "Redacted token name"), tokenPrefix: safePrefix(record.getString("token_prefix")),
      scopes: record.get("scopes") || [], owner: userSnapshot(txApp, record.getString("created_by")),
      status: "revoked", expiresAt: record.getString("expires_at"), revokedAt: record.getString("revoked_at"),
      revokedBy: userSnapshot(txApp, record.getString("revoked_by")),
      revocationReason: record.getString("revocation_reason"), createdAt: record.getString("created"),
      updatedAt: record.getString("updated"),
    };
    if (record.getString("last_used_at")) value.lastUsedAt = record.getString("last_used_at");
    return value;
  }
  const body = e.requestInfo().body;
  const id = e.request.pathValue("id");
  const reason = String(body.revocation_reason || "").trim();
  const normalizedInput = parseJson(body.admin_action_normalized_input, null);
  if (
    !reason || reason.length > 500 || hasBearerMaterial(reason) ||
    !normalizedInput || typeof normalizedInput !== "object" || Array.isArray(normalizedInput) ||
    normalizedInput.id !== id || normalizedInput.reason !== reason
  ) {
    throw new BadRequestError("MCP token revocation reason is invalid.");
  }
  let result;
  $app.runInTransaction((txApp) => {
    const action = txApp.findRecordById("admin_actions", String(body.admin_action_id || ""));
    const expectedFingerprint = $security.sha256(canonicalJson({
      targetCollection: "mcp_tokens", targetId: id, normalizedInput,
    }));
    if (
      action.getString("status") !== "pending" ||
      action.getString("attempt_token") !== String(body.admin_action_attempt_token || "") ||
      action.getString("target_collection") !== "mcp_tokens" || action.getString("target_id") !== id ||
      action.getString("operation_kind") !== "mcp_token.revoke" ||
      action.getString("operation_kind") !== String(body.admin_action_operation_kind || "") ||
      action.getString("input_fingerprint") !== expectedFingerprint
    ) {
      throw new BadRequestError("MCP token Admin Action attempt is no longer active.");
    }
    const actor = txApp.findRecordById("users", action.getString("actor_user"));
    if (actor.getString("role") !== "admin") throw new ForbiddenError("Current admin access is required.");
    const record = txApp.findRecordById("mcp_tokens", id);
    const owner = txApp.findRecordById("users", record.getString("created_by"));
    if (record.getString("revoked_at") || Date.parse(record.getString("expires_at")) <= Date.now() || owner.getString("role") !== "admin") {
      throw new BadRequestError("Only an active MCP token can be revoked.");
    }
    const beforeSummary = summary(record, "active", "");
    const revokedAt = new Date().toISOString();
    record.set("revoked_at", revokedAt);
    record.set("revoked_by", action.getString("actor_user"));
    record.set("revocation_reason", reason);
    txApp.save(record);
    const afterSummary = summary(record, "revoked", reason);
    const replayResult = { kind: "mcp_token_revoke", data: { token: snapshot(txApp, record) } };
    action.set("status", "applied");
    action.set("before_summary", beforeSummary);
    action.set("after_summary", afterSummary);
    action.set("replay_result", replayResult);
    action.set("lease_expires_at", "");
    action.set("completed_at", revokedAt);
    txApp.save(action);
    result = response(record);
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

onRecordValidate((e) => {
  const original = e.record.original();
  if (!original.id) return e.next();
  for (const field of ["name", "token_id", "token_prefix", "secret_hash", "scopes", "created_by", "expires_at", "created"]) {
    if (JSON.stringify(original.get(field)) !== JSON.stringify(e.record.get(field))) {
      throw new BadRequestError("MCP token credential and ownership fields are immutable.");
    }
  }
  const previousRevokedAt = original.getString("revoked_at");
  const nextRevokedAt = e.record.getString("revoked_at");
  if (previousRevokedAt && (
    previousRevokedAt !== nextRevokedAt ||
    original.getString("revoked_by") !== e.record.getString("revoked_by") ||
    original.getString("revocation_reason") !== e.record.getString("revocation_reason")
  )) {
    throw new BadRequestError("MCP token revocation is immutable.");
  }
  if (!previousRevokedAt && nextRevokedAt && (
    !e.record.getString("revoked_by") || !e.record.getString("revocation_reason").trim()
  )) {
    throw new BadRequestError("MCP token revocation requires an admin and reason.");
  }
  return e.next();
}, "mcp_tokens");

onRecordDelete(() => {
  throw new BadRequestError("MCP token history cannot be deleted.");
}, "mcp_tokens");

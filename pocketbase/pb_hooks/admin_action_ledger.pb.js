/// <reference path="../pb_data/types.d.ts" />

// PocketBase serializes route callbacks without outer lexical helpers.
routerAdd("POST", "/api/wts/admin-actions/{id}/claim", (e) => {
  function response(record) {
    return {
      id: record.id, actor_user: record.getString("actor_user"), mcp_token: record.getString("mcp_token"),
      source: record.getString("source"), operation_kind: record.getString("operation_kind"),
      target_collection: record.getString("target_collection"), target_id: record.getString("target_id"),
      operation_id: record.getString("operation_id"), input_fingerprint: record.getString("input_fingerprint"),
      status: record.getString("status"), before_summary: record.get("before_summary"),
      after_summary: record.get("after_summary"), replay_result: record.get("replay_result"),
      failure_code: record.getString("failure_code"), failure_message: record.getString("failure_message"),
      failure_metadata: record.get("failure_metadata"), attempt_count: record.getInt("attempt_count"),
      lease_expires_at: record.getString("lease_expires_at"), created: record.getString("created"),
      updated: record.getString("updated"),
    };
  }
  function timestamp(value) {
    return Date.parse(String(value || "").replace(" ", "T"));
  }
  const body = e.requestInfo().body;
  let result;
  $app.runInTransaction((txApp) => {
    const record = txApp.findRecordById("admin_actions", e.request.pathValue("id"));
    if (record.getString("input_fingerprint") !== String(body.input_fingerprint || "")) {
      result = { outcome: "mismatch", action: response(record) };
      return;
    }
    const status = record.getString("status");
    if (status === "applied") {
      result = { outcome: "replayed", action: response(record) };
      return;
    }
    const now = String(body.now || "");
    const lease = record.getString("lease_expires_at");
    if (status === "pending" && lease && timestamp(lease) > timestamp(now)) {
      result = { outcome: "pending", action: response(record) };
      return;
    }
    record.set("status", "pending");
    record.set("attempt_count", record.getInt("attempt_count") + 1);
    record.set("attempt_token", String(body.attempt_token || ""));
    record.set("lease_expires_at", String(body.lease_expires_at || ""));
    record.set("failure_code", "");
    record.set("failure_message", "");
    record.set("failure_metadata", null);
    txApp.save(record);
    result = {
      outcome: "started",
      action: response(record),
      handle: { actionId: record.id, attemptToken: record.getString("attempt_token") },
    };
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

routerAdd("POST", "/api/wts/admin-actions/{id}/complete", (e) => {
  function response(record) {
    return {
      id: record.id, actor_user: record.getString("actor_user"), mcp_token: record.getString("mcp_token"),
      source: record.getString("source"), operation_kind: record.getString("operation_kind"),
      target_collection: record.getString("target_collection"), target_id: record.getString("target_id"),
      operation_id: record.getString("operation_id"), input_fingerprint: record.getString("input_fingerprint"),
      status: record.getString("status"), before_summary: record.get("before_summary"),
      after_summary: record.get("after_summary"), replay_result: record.get("replay_result"),
      failure_code: record.getString("failure_code"), failure_message: record.getString("failure_message"),
      failure_metadata: record.get("failure_metadata"), attempt_count: record.getInt("attempt_count"),
      lease_expires_at: record.getString("lease_expires_at"), created: record.getString("created"),
      updated: record.getString("updated"),
    };
  }
  function parseJson(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  }
  function assertPayload(value, label, maximumBytes) {
    if (toBytes(JSON.stringify(value)).length > maximumBytes) throw new BadRequestError(`${label} is too large.`);
    const blocked = ["accesstoken", "authorization", "bearertoken", "clientsecret", "notes", "password", "payload", "rawbody", "rawrequest", "refreshtoken", "requestbody", "secret", "secrethash"];
    const safeNoteMetadata = ["noteagentvisible", "notechanged", "notelength", "notepresent"];
    function visit(item, depth) {
      if (depth > 6) throw new BadRequestError(`${label} is too deeply nested.`);
      if (!item || typeof item !== "object") return;
      if (Array.isArray(item)) {
        if (item.length > 50) throw new BadRequestError(`${label} contains too many values.`);
        for (const child of item) visit(child, depth + 1);
        return;
      }
      const keys = Object.keys(item);
      if (keys.length > 50) throw new BadRequestError(`${label} contains too many fields.`);
      for (const key of keys) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (blocked.includes(normalized) || (normalized.includes("note") && !safeNoteMetadata.includes(normalized))) {
          throw new BadRequestError(`${label} contains a sensitive field.`);
        }
        visit(item[key], depth + 1);
      }
    }
    visit(value, 0);
  }
  const body = e.requestInfo().body;
  const beforeSummary = parseJson(body.before_summary, null);
  const afterSummary = parseJson(body.after_summary, null);
  const replayResult = parseJson(body.replay_result, null);
  assertPayload(beforeSummary, "Admin Action before summary", 2048);
  assertPayload(afterSummary, "Admin Action after summary", 2048);
  assertPayload(replayResult, "Admin Action replay result", 32768);
  let result;
  $app.runInTransaction((txApp) => {
    const record = txApp.findRecordById("admin_actions", e.request.pathValue("id"));
    if (record.getString("status") !== "pending" || record.getString("attempt_token") !== String(body.attempt_token || "")) {
      throw new BadRequestError("Admin Action attempt is no longer active.");
    }
    const reservedTargetId = record.getString("target_id");
    const completedTargetId = String(body.target_id || "");
    if (reservedTargetId && completedTargetId && reservedTargetId !== completedTargetId) {
      throw new BadRequestError("Admin Action completion cannot change its reserved target.");
    }
    record.set("status", "applied");
    if (!reservedTargetId && completedTargetId) record.set("target_id", completedTargetId);
    record.set("before_summary", beforeSummary);
    record.set("after_summary", afterSummary);
    record.set("replay_result", replayResult);
    record.set("lease_expires_at", "");
    record.set("completed_at", String(body.now || ""));
    txApp.save(record);
    result = response(record);
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

routerAdd("POST", "/api/wts/admin-actions/{id}/fail", (e) => {
  function response(record) {
    return {
      id: record.id, actor_user: record.getString("actor_user"), mcp_token: record.getString("mcp_token"),
      source: record.getString("source"), operation_kind: record.getString("operation_kind"),
      target_collection: record.getString("target_collection"), target_id: record.getString("target_id"),
      operation_id: record.getString("operation_id"), input_fingerprint: record.getString("input_fingerprint"),
      status: record.getString("status"), before_summary: record.get("before_summary"),
      after_summary: record.get("after_summary"), replay_result: record.get("replay_result"),
      failure_code: record.getString("failure_code"), failure_message: record.getString("failure_message"),
      failure_metadata: record.get("failure_metadata"), attempt_count: record.getInt("attempt_count"),
      lease_expires_at: record.getString("lease_expires_at"), created: record.getString("created"),
      updated: record.getString("updated"),
    };
  }
  function parseJson(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  }
  function assertPayload(value, label, maximumBytes) {
    if (toBytes(JSON.stringify(value)).length > maximumBytes) throw new BadRequestError(`${label} is too large.`);
    const blocked = ["accesstoken", "authorization", "bearertoken", "clientsecret", "notes", "password", "payload", "rawbody", "rawrequest", "refreshtoken", "requestbody", "secret", "secrethash"];
    const safeNoteMetadata = ["noteagentvisible", "notechanged", "notelength", "notepresent"];
    function visit(item, depth) {
      if (depth > 6) throw new BadRequestError(`${label} is too deeply nested.`);
      if (!item || typeof item !== "object") return;
      if (Array.isArray(item)) {
        if (item.length > 50) throw new BadRequestError(`${label} contains too many values.`);
        for (const child of item) visit(child, depth + 1);
        return;
      }
      const keys = Object.keys(item);
      if (keys.length > 50) throw new BadRequestError(`${label} contains too many fields.`);
      for (const key of keys) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (blocked.includes(normalized) || (normalized.includes("note") && !safeNoteMetadata.includes(normalized))) {
          throw new BadRequestError(`${label} contains a sensitive field.`);
        }
        visit(item[key], depth + 1);
      }
    }
    visit(value, 0);
  }
  const body = e.requestInfo().body;
  const metadata = parseJson(body.failure_metadata, null);
  assertPayload(metadata, "Admin Action failure metadata", 1024);
  let result;
  $app.runInTransaction((txApp) => {
    const record = txApp.findRecordById("admin_actions", e.request.pathValue("id"));
    if (record.getString("status") !== "pending" || record.getString("attempt_token") !== String(body.attempt_token || "")) {
      throw new BadRequestError("Admin Action attempt is no longer active.");
    }
    record.set("status", "failed");
    record.set("failure_code", String(body.failure_code || ""));
    record.set("failure_message", String(body.failure_message || ""));
    record.set("failure_metadata", metadata);
    record.set("lease_expires_at", "");
    record.set("completed_at", String(body.now || ""));
    txApp.save(record);
    result = response(record);
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

onRecordValidate((e) => {
  const original = e.record.original();
  if (!original.id) return e.next();
  for (const field of [
    "actor_user",
    "mcp_token",
    "source",
    "operation_kind",
    "target_collection",
    "operation_id",
    "input_fingerprint",
    "idempotency_key",
    "created",
  ]) {
    if (JSON.stringify(original.get(field)) !== JSON.stringify(e.record.get(field))) {
      throw new BadRequestError("Admin Action identity fields are immutable.");
    }
  }
  const previous = original.getString("status");
  const next = e.record.getString("status");
  if (previous === "applied") {
    throw new BadRequestError("Applied Admin Action history is immutable.");
  }
  const valid =
    (previous === "pending" && ["pending", "applied", "failed"].includes(next)) ||
    (previous === "failed" && next === "pending");
  if (!valid) throw new BadRequestError("Admin Action status transition is invalid.");
  return e.next();
}, "admin_actions");

onRecordDelete(() => {
  throw new BadRequestError("Admin Action history cannot be deleted.");
}, "admin_actions");

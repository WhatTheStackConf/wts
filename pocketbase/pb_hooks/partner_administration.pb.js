/// <reference path="../pb_data/types.d.ts" />

// PocketBase serializes route callbacks without outer lexical helpers.

routerAdd("POST", "/api/wts/partners", (e) => {
  function responseRecord(record) {
    return {
      id: record.id, name: record.getString("name"), normalized_name: record.getString("normalized_name"),
      published: record.getBool("published"), type: record.getString("type"), tier: record.getString("tier"),
      logo: record.getString("logo"), logo_surface: record.getString("logo_surface"),
      logo_uploaded_by_human: record.getBool("logo_uploaded_by_human"),
      url: record.getString("url"), canonical_url: record.getString("canonical_url"),
      mutation_token: record.getString("mutation_token"), notes: record.getString("notes"),
      note_agent_visible: record.getBool("note_agent_visible"), created: record.getString("created"),
      updated: record.getString("updated"),
    };
  }
  function mutationBody() {
    function base64(bytes) {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const parts = [];
      let chunk = "";
      for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index];
        const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
        const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
        chunk += alphabet[first >> 2];
        chunk += alphabet[((first & 3) << 4) | (second >> 4)];
        chunk += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | (third >> 6)] : "=";
        chunk += index + 2 < bytes.length ? alphabet[third & 63] : "=";
        if (chunk.length >= 8192) {
          parts.push(chunk);
          chunk = "";
        }
      }
      if (chunk) parts.push(chunk);
      return parts.join("");
    }
    const result = { body: {}, upload: null };
    for (const key in e.requestInfo().body) {
      if (!key.startsWith("admin_action_")) result.body[key] = e.requestInfo().body[key];
    }
    let file = null;
    try {
      file = e.request.formFile("logo");
    } catch {
      // No logo was uploaded.
    }
    if (file && file[1]) {
      const header = file[1];
      if (header.size > 5242880) throw new BadRequestError("Partner logo is too large.");
      const reader = header.open();
      let bytes;
      try {
        bytes = toBytes(reader, 5242881);
      } finally {
        reader.close();
      }
      result.upload = {
        mediaType: String(header.header.get("Content-Type") || "").split(";")[0].trim().toLowerCase(),
        fingerprint: $security.sha256(base64(bytes)),
      };
      result.body.logo = $filesystem.fileFromMultipart(header);
    }
    return result;
  }
  function completeAction(txApp, requestBody, partnerRecord, body, upload) {
    function requestBool(value) {
      return value === true || value === 1 || String(value).toLowerCase() === "true";
    }
    function parseJson(value, fallback) {
      if (value === undefined || value === null || value === "") return fallback;
      return typeof value === "string" ? JSON.parse(value) : value;
    }
    function canonicalJson(value) {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    }
    function hasSecretMaterial(item) {
      const text = String(item || "");
      return /wts_mcp_[a-f0-9]{24}_[a-z0-9_-]{20,}/i.test(text) ||
        /(^|[^a-f0-9])[a-f0-9]{64}([^a-f0-9]|$)/i.test(text);
    }
    function safeReplayText(value, redacted) {
      return hasSecretMaterial(value) ? redacted : value;
    }
    function assertPayload(value, label, maximumBytes) {
      if (toBytes(JSON.stringify(value)).length > maximumBytes) throw new BadRequestError(`${label} is too large.`);
      const blocked = ["accesstoken", "authorization", "bearertoken", "clientsecret", "notes", "password", "payload", "rawbody", "rawrequest", "refreshtoken", "requestbody", "secret", "secrethash"];
      const safeNoteMetadata = ["noteagentvisible", "notechanged", "notelength", "notepresent"];
      function isSensitiveKey(key) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        return blocked.includes(normalized) || (normalized.includes("note") && !safeNoteMetadata.includes(normalized));
      }
      function visitArray(item, depth) {
        if (item.length > 50) throw new BadRequestError(`${label} contains too many values.`);
        for (const child of item) visit(child, depth + 1);
      }
      function visitObject(item, depth) {
        const keys = Object.keys(item);
        if (keys.length > 50) throw new BadRequestError(`${label} contains too many fields.`);
        for (const key of keys) {
          if (isSensitiveKey(key)) throw new BadRequestError(`${label} contains a sensitive field.`);
          visit(item[key], depth + 1);
        }
      }
      function visit(item, depth) {
        if (depth > 6) throw new BadRequestError(`${label} is too deeply nested.`);
        if (typeof item === "string" && hasSecretMaterial(item)) throw new BadRequestError(`${label} contains credential or hash material.`);
        if (!item || typeof item !== "object") return;
        if (Array.isArray(item)) visitArray(item, depth);
        else visitObject(item, depth);
      }
      visit(value, 0);
    }
    function isObject(value) {
      return value && typeof value === "object" && !Array.isArray(value);
    }
    function isPendingCreate(action) {
      return action.getString("status") === "pending" &&
        action.getString("attempt_token") === String(requestBody.admin_action_attempt_token || "") &&
        action.getString("target_collection") === "partners" &&
        action.getString("operation_kind") === "partner.create" &&
        action.getString("operation_kind") === String(requestBody.admin_action_operation_kind || "") &&
        !action.getString("target_id");
    }
    const reservedFields = [
      { body: "name", input: "name" }, { body: "normalized_name", input: "normalizedName" },
      { body: "type", input: "type" }, { body: "tier", input: "tier" },
      { body: "logo_surface", input: "logoSurface" }, { body: "url", input: "urlValue" },
      { body: "canonical_url", input: "url" },
    ];
    function createBodyMismatch(action, normalizedInput, expectedFingerprint) {
      return expectedFingerprint !== action.getString("input_fingerprint") || !isObject(normalizedInput) ||
        !reservedFields.every((field) => String(body[field.body] || "") === String(normalizedInput[field.input] || "")) ||
        requestBool(body.published) || requestBool(body.note_agent_visible);
    }
    function noteMismatch(expectedNote, note) {
      return !isObject(expectedNote) ||
        Boolean(expectedNote.present) !== Boolean(note) ||
        (note && (expectedNote.length !== note.length || expectedNote.fingerprint !== $security.sha256(note)));
    }
    function uploadedFileMismatch(expectedLogo, file) {
      return String(file.originalName || file.name || "") !== String(expectedLogo.name || "") ||
        Number(file.size || 0) !== Number(expectedLogo.bytes || -1);
    }
    function uploadDigestMismatch(expectedLogo) {
      return !upload || upload.mediaType !== String(expectedLogo.mediaType || "") ||
        upload.fingerprint !== String(expectedLogo.fingerprint || "");
    }
    function uploadMismatch(expectedLogo) {
      return expectedLogo.present !== true || !requestBool(body.logo_uploaded_by_human) || !body.logo ||
        uploadedFileMismatch(expectedLogo, body.logo) || uploadDigestMismatch(expectedLogo);
    }
    function assertCreateLogo(expectedLogo) {
      if (!isObject(expectedLogo)) {
        throw new BadRequestError("Partner create logo input is invalid.");
      }
      if (expectedLogo.changed === false) {
        if (requestBool(body.logo_uploaded_by_human) || body.logo !== undefined) {
          throw new BadRequestError("Partner create changed unreserved logo state.");
        }
      } else if (uploadMismatch(expectedLogo)) {
        throw new BadRequestError("Partner create logo does not match its reserved input.");
      }
    }
    function replayPartner() {
      const stored = responseRecord(partnerRecord);
      const partner = {
        id: stored.id, name: safeReplayText(stored.name, "Redacted Partner name"), published: stored.published, type: stored.type,
        logo: safeReplayText(stored.logo, "Redacted Partner logo"), logoSurface: stored.logo_surface,
        noteAgentVisible: stored.note_agent_visible, createdAt: stored.created, updatedAt: stored.updated,
        version: `${stored.updated}|${stored.mutation_token}`,
      };
      if (stored.tier) partner.tier = stored.tier;
      if (stored.url) partner.url = safeReplayText(stored.url, "[redacted credential or hash]");
      return partner;
    }
    function attachReplayPartner(replayResult) {
      if (isObject(replayResult) && replayResult.kind === "partner_mutation" && isObject(replayResult.data)) {
        replayResult.data.partner = replayPartner();
      }
    }
    const action = txApp.findRecordById("admin_actions", String(requestBody.admin_action_id || ""));
    const targetId = partnerRecord.id;
    if (!isPendingCreate(action)) {
      throw new BadRequestError("Partner Admin Action attempt is no longer active.");
    }
    const normalizedInput = parseJson(requestBody.admin_action_normalized_input, null);
    const expectedFingerprint = $security.sha256(canonicalJson({
      targetCollection: "partners",
      targetId: null,
      normalizedInput,
    }));
    if (createBodyMismatch(action, normalizedInput, expectedFingerprint)) {
      throw new BadRequestError("Partner create body does not match its reserved input.");
    }
    const note = String(body.notes || "").trim();
    if (noteMismatch(normalizedInput.partnerNote, note)) {
      throw new BadRequestError("Partner create Note does not match its reserved input.");
    }
    assertCreateLogo(normalizedInput.logo);
    const beforeSummary = parseJson(requestBody.admin_action_before_summary, null);
    const afterSummary = parseJson(requestBody.admin_action_after_summary, null);
    const replayResult = parseJson(requestBody.admin_action_replay_result, null);
    if (isObject(afterSummary)) afterSummary.id = targetId;
    attachReplayPartner(replayResult);
    assertPayload(beforeSummary, "Admin Action before summary", 2048);
    assertPayload(afterSummary, "Admin Action after summary", 2048);
    assertPayload(replayResult, "Admin Action replay result", 32768);
    action.set("target_id", targetId);
    action.set("status", "applied");
    action.set("before_summary", beforeSummary);
    action.set("after_summary", afterSummary);
    action.set("replay_result", replayResult);
    action.set("lease_expires_at", "");
    action.set("completed_at", new Date().toISOString());
    txApp.save(action);
  }
  const request = e.requestInfo();
  const mutation = mutationBody();
  const body = mutation.body;
  let result;
  $app.runInTransaction((txApp) => {
    const record = new Record(txApp.findCollectionByNameOrId("partners"));
    const form = new RecordUpsertForm(txApp, record);
    form.grantSuperuserAccess();
    form.load(body);
    form.submit();
    completeAction(txApp, request.body, record, body, mutation.upload);
    result = responseRecord(record);
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

routerAdd("PATCH", "/api/wts/partners/{id}", (e) => {
  function requestBool(value) {
    return value === true || value === 1 || String(value).toLowerCase() === "true";
  }
  function assertOperationFields(action, record, body, requestBody, upload) {
    function canonicalJson(value) {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    }
    function isObject(value) {
      return value && typeof value === "object" && !Array.isArray(value);
    }
    function noteMismatch(expectedNote, note) {
      return !isObject(expectedNote) ||
        Boolean(expectedNote.present) !== Boolean(note) ||
        (note && (expectedNote.length !== note.length || expectedNote.fingerprint !== $security.sha256(note)));
    }
    function uploadedFileMismatch(expectedLogo, file) {
      return String(file.originalName || file.name || "") !== String(expectedLogo.name || "") ||
        Number(file.size || 0) !== Number(expectedLogo.bytes || -1);
    }
    function uploadDigestMismatch(expectedLogo) {
      return !upload || upload.mediaType !== String(expectedLogo.mediaType || "") ||
        upload.fingerprint !== String(expectedLogo.fingerprint || "");
    }
    function uploadMismatch(expectedLogo) {
      return expectedLogo.present !== true || !requestBool(body.logo_uploaded_by_human) || !body.logo ||
        uploadedFileMismatch(expectedLogo, body.logo) || uploadDigestMismatch(expectedLogo);
    }
    const normalizedInput = JSON.parse(String(requestBody.admin_action_normalized_input || "null"));
    const expectedFingerprint = $security.sha256(canonicalJson({
      targetCollection: "partners",
      targetId: action.getString("target_id") || null,
      normalizedInput,
    }));
    if (expectedFingerprint !== action.getString("input_fingerprint")) {
      throw new BadRequestError("Partner Admin Action input does not match its reservation.");
    }
    const kind = action.getString("operation_kind");
    const sameText = (field) => String(body[field] || "") === record.getString(field);
    const sameBool = (field) => requestBool(body[field]) === record.getBool(field);
    const unchangedLogo = () => sameBool("logo_uploaded_by_human") && body.logo === undefined;
    function concurrencyMatches() {
      const requestedVersion = String(requestBody.expected_version || "");
      const versionSeparator = requestedVersion.lastIndexOf("|");
      const requestedUpdatedAt = versionSeparator > 0
        ? requestedVersion.slice(0, versionSeparator)
        : requestedVersion;
      return normalizedInput &&
        (normalizedInput.expectedVersion === requestedVersion ||
          normalizedInput.expectedUpdatedAt === requestedUpdatedAt);
    }
    function patchInputInvalid() {
      return !isObject(normalizedInput) || normalizedInput.id !== record.id ||
        !concurrencyMatches() || !isObject(normalizedInput.patch);
    }
    const patchTextFields = [
      { body: "name", record: "name", patch: "name" },
      { body: "normalized_name", record: "normalized_name", patch: "normalizedName" },
      { body: "type", record: "type", patch: "type" },
      { body: "tier", record: "tier", patch: "tier" },
      { body: "logo_surface", record: "logo_surface", patch: "logoSurface" },
      { body: "url", record: "url", patch: "urlValue" },
      { body: "canonical_url", record: "canonical_url", patch: "url" },
    ];
    function patchedTextMatches(patch, has, field) {
      const expected = has(field.patch)
        ? field.body === "tier" && String(body.type || "") !== "sponsor" ? "" : patch[field.patch]
        : record.getString(field.record);
      return String(body[field.body] || "") === String(expected || "");
    }
    function assertPatchNote(patch, has) {
      if (has("partnerNote")) {
        if (noteMismatch(patch.partnerNote, String(body.notes || "").trim()) || requestBool(body.note_agent_visible)) {
          throw new BadRequestError("Partner Note patch does not match its reserved input.");
        }
      } else if (!sameText("notes") || !sameBool("note_agent_visible")) {
        throw new BadRequestError("Partner patch changed unreserved Partner Note state.");
      }
    }
    function assertReservedLogo(expectedLogo) {
      if (!isObject(expectedLogo)) {
        throw new BadRequestError("Partner logo patch input is invalid.");
      }
      if (expectedLogo.changed === false) {
        if (!unchangedLogo()) throw new BadRequestError("Partner patch changed unreserved logo state.");
      } else if (expectedLogo.present === false) {
        if (requestBool(body.logo_uploaded_by_human) || String(body.logo || "") !== "") {
          throw new BadRequestError("Partner logo removal does not match its reserved input.");
        }
      } else if (uploadMismatch(expectedLogo)) {
        throw new BadRequestError("Partner logo upload does not match its reserved input.");
      }
    }
    function assertPatchLogo(patch, has) {
      if (has("logo")) assertReservedLogo(patch.logo);
      else if (!unchangedLogo()) throw new BadRequestError("Partner patch changed unreserved logo state.");
    }
    function assertPatchFields() {
      if (patchInputInvalid()) {
        throw new BadRequestError("Partner patch input is invalid.");
      }
      const patch = normalizedInput.patch;
      const allowed = ["logo", "logoSurface", "name", "normalizedName", "partnerNote", "tier", "type", "url", "urlValue"];
      if (Object.keys(patch).some((field) => !allowed.includes(field))) {
        throw new BadRequestError("Partner patch input contains an unsupported field.");
      }
      const has = (field) => Object.prototype.hasOwnProperty.call(patch, field);
      if (!patchTextFields.every((field) => patchedTextMatches(patch, has, field))) {
        throw new BadRequestError("Partner patch body does not match its reserved input.");
      }
      assertPatchNote(patch, has);
      assertPatchLogo(patch, has);
      if (!sameBool("published")) throw new BadRequestError("Partner patch cannot change publication.");
    }
    function assertSpecializedInput() {
      if (
        !isObject(normalizedInput) ||
        normalizedInput.id !== record.id ||
        normalizedInput.expectedVersion !== String(requestBody.expected_version || "")
      ) {
        throw new BadRequestError("Specialized Partner operation input is invalid.");
      }
      for (const field of ["name", "normalized_name", "type", "tier", "logo_surface", "url", "canonical_url", "notes"]) {
        if (!sameText(field)) throw new BadRequestError("Specialized Partner operation changed unrelated fields.");
      }
      if (!unchangedLogo()) {
        throw new BadRequestError("Specialized Partner operation changed logo state.");
      }
    }
    function assertPublicationFields() {
      const expectedPublished = kind === "partner.publish";
      if (
        requestBool(body.published) !== expectedPublished ||
        Boolean(normalizedInput.published) !== expectedPublished ||
        !sameBool("note_agent_visible")
      ) {
        throw new BadRequestError("Partner publication operation changed unrelated state.");
      }
    }
    if (kind === "partner.patch") {
      assertPatchFields();
      return;
    }
    assertSpecializedInput();
    if (kind === "partner.note_approval") {
      if (!sameBool("published") || requestBool(body.note_agent_visible) !== Boolean(normalizedInput.approved)) {
        throw new BadRequestError("Partner Note approval does not match its reserved input.");
      }
      return;
    }
    assertPublicationFields();
  }
  function responseRecord(record) {
    return {
      id: record.id, name: record.getString("name"), normalized_name: record.getString("normalized_name"),
      published: record.getBool("published"), type: record.getString("type"), tier: record.getString("tier"),
      logo: record.getString("logo"), logo_surface: record.getString("logo_surface"),
      logo_uploaded_by_human: record.getBool("logo_uploaded_by_human"),
      url: record.getString("url"), canonical_url: record.getString("canonical_url"),
      mutation_token: record.getString("mutation_token"), notes: record.getString("notes"),
      note_agent_visible: record.getBool("note_agent_visible"), created: record.getString("created"),
      updated: record.getString("updated"),
    };
  }
  function mutationBody() {
    function base64(bytes) {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const parts = [];
      let chunk = "";
      for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index];
        const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
        const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
        chunk += alphabet[first >> 2];
        chunk += alphabet[((first & 3) << 4) | (second >> 4)];
        chunk += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | (third >> 6)] : "=";
        chunk += index + 2 < bytes.length ? alphabet[third & 63] : "=";
        if (chunk.length >= 8192) {
          parts.push(chunk);
          chunk = "";
        }
      }
      if (chunk) parts.push(chunk);
      return parts.join("");
    }
    const result = { body: {}, upload: null };
    for (const key in e.requestInfo().body) {
      if (key !== "expected_version" && !key.startsWith("admin_action_")) result.body[key] = e.requestInfo().body[key];
    }
    let file = null;
    try {
      file = e.request.formFile("logo");
    } catch {
      // No replacement logo was uploaded.
    }
    if (file && file[1]) {
      const header = file[1];
      if (header.size > 5242880) throw new BadRequestError("Partner logo is too large.");
      const reader = header.open();
      let bytes;
      try {
        bytes = toBytes(reader, 5242881);
      } finally {
        reader.close();
      }
      result.upload = {
        mediaType: String(header.header.get("Content-Type") || "").split(";")[0].trim().toLowerCase(),
        fingerprint: $security.sha256(base64(bytes)),
      };
      result.body.logo = $filesystem.fileFromMultipart(header);
    }
    return result;
  }
  function completeAction(txApp, requestBody, partnerRecord) {
    function parseJson(value, fallback) {
      if (value === undefined || value === null || value === "") return fallback;
      return typeof value === "string" ? JSON.parse(value) : value;
    }
    function hasSecretMaterial(item) {
      const text = String(item || "");
      return /wts_mcp_[a-f0-9]{24}_[a-z0-9_-]{20,}/i.test(text) ||
        /(^|[^a-f0-9])[a-f0-9]{64}([^a-f0-9]|$)/i.test(text);
    }
    function safeReplayText(value, redacted) {
      return hasSecretMaterial(value) ? redacted : value;
    }
    function assertPayload(value, label, maximumBytes) {
      if (toBytes(JSON.stringify(value)).length > maximumBytes) throw new BadRequestError(`${label} is too large.`);
      const blocked = ["accesstoken", "authorization", "bearertoken", "clientsecret", "notes", "password", "payload", "rawbody", "rawrequest", "refreshtoken", "requestbody", "secret", "secrethash"];
      const safeNoteMetadata = ["noteagentvisible", "notechanged", "notelength", "notepresent"];
      function isSensitiveKey(key) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        return blocked.includes(normalized) || (normalized.includes("note") && !safeNoteMetadata.includes(normalized));
      }
      function visitArray(item, depth) {
        if (item.length > 50) throw new BadRequestError(`${label} contains too many values.`);
        for (const child of item) visit(child, depth + 1);
      }
      function visitObject(item, depth) {
        const keys = Object.keys(item);
        if (keys.length > 50) throw new BadRequestError(`${label} contains too many fields.`);
        for (const key of keys) {
          if (isSensitiveKey(key)) throw new BadRequestError(`${label} contains a sensitive field.`);
          visit(item[key], depth + 1);
        }
      }
      function visit(item, depth) {
        if (depth > 6) throw new BadRequestError(`${label} is too deeply nested.`);
        if (typeof item === "string" && hasSecretMaterial(item)) throw new BadRequestError(`${label} contains credential or hash material.`);
        if (!item || typeof item !== "object") return;
        if (Array.isArray(item)) visitArray(item, depth);
        else visitObject(item, depth);
      }
      visit(value, 0);
    }
    function isObject(value) {
      return value && typeof value === "object" && !Array.isArray(value);
    }
    function isPendingUpdate(action, targetId) {
      const allowedOperationKinds = ["partner.patch", "partner.note_approval", "partner.publish", "partner.unpublish"];
      return action.getString("status") === "pending" &&
        action.getString("attempt_token") === String(requestBody.admin_action_attempt_token || "") &&
        action.getString("target_collection") === "partners" &&
        allowedOperationKinds.includes(action.getString("operation_kind")) &&
        action.getString("operation_kind") === String(requestBody.admin_action_operation_kind || "") &&
        action.getString("target_id") === targetId;
    }
    function replayPartner() {
      const stored = responseRecord(partnerRecord);
      const partner = {
        id: stored.id, name: safeReplayText(stored.name, "Redacted Partner name"), published: stored.published, type: stored.type,
        logo: safeReplayText(stored.logo, "Redacted Partner logo"), logoSurface: stored.logo_surface,
        noteAgentVisible: stored.note_agent_visible, createdAt: stored.created, updatedAt: stored.updated,
        version: `${stored.updated}|${stored.mutation_token}`,
      };
      if (stored.tier) partner.tier = stored.tier;
      if (stored.url) partner.url = safeReplayText(stored.url, "[redacted credential or hash]");
      return partner;
    }
    function attachReplayPartner(replayResult) {
      if (isObject(replayResult) && replayResult.kind === "partner_mutation" && isObject(replayResult.data)) {
        replayResult.data.partner = replayPartner();
      }
    }
    const action = txApp.findRecordById("admin_actions", String(requestBody.admin_action_id || ""));
    const targetId = partnerRecord.id;
    if (!isPendingUpdate(action, targetId)) {
      throw new BadRequestError("Partner Admin Action attempt is no longer active.");
    }
    const beforeSummary = parseJson(requestBody.admin_action_before_summary, null);
    const afterSummary = parseJson(requestBody.admin_action_after_summary, null);
    const replayResult = parseJson(requestBody.admin_action_replay_result, null);
    if (isObject(afterSummary)) afterSummary.id = targetId;
    attachReplayPartner(replayResult);
    assertPayload(beforeSummary, "Admin Action before summary", 2048);
    assertPayload(afterSummary, "Admin Action after summary", 2048);
    assertPayload(replayResult, "Admin Action replay result", 32768);
    action.set("target_id", targetId);
    action.set("status", "applied");
    action.set("before_summary", beforeSummary);
    action.set("after_summary", afterSummary);
    action.set("replay_result", replayResult);
    action.set("lease_expires_at", "");
    action.set("completed_at", new Date().toISOString());
    txApp.save(action);
  }
  const request = e.requestInfo();
  const expectedVersion = String(request.body.expected_version || "");
  const separator = expectedVersion.lastIndexOf("|");
  if (separator < 1 || separator === expectedVersion.length - 1) {
    throw new BadRequestError("Partner update requires expected_version.");
  }
  const expectedTimestamp = expectedVersion.slice(0, separator);
  const expectedToken = expectedVersion.slice(separator + 1);
  const mutation = mutationBody();
  const body = mutation.body;

  let result;
  $app.runInTransaction((txApp) => {
    const id = e.request.pathValue("id");
    const nextToken = $security.randomString(32);
    const claimed = txApp.db().newQuery(`
      UPDATE partners
      SET mutation_token = {:nextToken}
      WHERE id = {:id} AND updated = {:expectedTimestamp} AND mutation_token = {:expectedToken}
    `).bind({ id, expectedTimestamp, expectedToken, nextToken }).execute();
    if (claimed.rowsAffected() !== 1) {
      result = { success: false, current: responseRecord(txApp.findRecordById("partners", id)) };
      return;
    }

    const record = txApp.findRecordById("partners", id);
    const action = txApp.findRecordById("admin_actions", String(request.body.admin_action_id || ""));
    assertOperationFields(action, record, body, request.body, mutation.upload);
    record.set("mutation_token", nextToken);
    const form = new RecordUpsertForm(txApp, record);
    form.grantSuperuserAccess();
    form.load(body);
    form.submit();
    completeAction(txApp, request.body, record);
    result = { success: true, record: responseRecord(record) };
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

routerAdd("DELETE", "/api/wts/partners/{id}", (e) => {
  function responseRecord(record) {
    return {
      id: record.id, name: record.getString("name"), normalized_name: record.getString("normalized_name"),
      published: record.getBool("published"), type: record.getString("type"), tier: record.getString("tier"),
      logo: record.getString("logo"), logo_surface: record.getString("logo_surface"),
      logo_uploaded_by_human: record.getBool("logo_uploaded_by_human"),
      url: record.getString("url"), canonical_url: record.getString("canonical_url"),
      mutation_token: record.getString("mutation_token"), notes: record.getString("notes"),
      note_agent_visible: record.getBool("note_agent_visible"), created: record.getString("created"),
      updated: record.getString("updated"),
    };
  }
  function completeAction(txApp, requestBody, targetId) {
    function parseJson(value, fallback) {
      if (value === undefined || value === null || value === "") return fallback;
      return typeof value === "string" ? JSON.parse(value) : value;
    }
    function canonicalJson(value) {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    }
    function assertPayload(value, label, maximumBytes) {
      if (toBytes(JSON.stringify(value)).length > maximumBytes) throw new BadRequestError(`${label} is too large.`);
      const blocked = ["accesstoken", "authorization", "bearertoken", "clientsecret", "notes", "password", "payload", "rawbody", "rawrequest", "refreshtoken", "requestbody", "secret", "secrethash"];
      const safeNoteMetadata = ["noteagentvisible", "notechanged", "notelength", "notepresent"];
      function hasSecretMaterial(item) {
        const text = String(item || "");
        return /wts_mcp_[a-f0-9]{24}_[a-z0-9_-]{20,}/i.test(text) ||
          /(^|[^a-f0-9])[a-f0-9]{64}([^a-f0-9]|$)/i.test(text);
      }
      function isSensitiveKey(key) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        return blocked.includes(normalized) || (normalized.includes("note") && !safeNoteMetadata.includes(normalized));
      }
      function visitArray(item, depth) {
        if (item.length > 50) throw new BadRequestError(`${label} contains too many values.`);
        for (const child of item) visit(child, depth + 1);
      }
      function visitObject(item, depth) {
        const keys = Object.keys(item);
        if (keys.length > 50) throw new BadRequestError(`${label} contains too many fields.`);
        for (const key of keys) {
          if (isSensitiveKey(key)) throw new BadRequestError(`${label} contains a sensitive field.`);
          visit(item[key], depth + 1);
        }
      }
      function visit(item, depth) {
        if (depth > 6) throw new BadRequestError(`${label} is too deeply nested.`);
        if (typeof item === "string" && hasSecretMaterial(item)) throw new BadRequestError(`${label} contains credential or hash material.`);
        if (!item || typeof item !== "object") return;
        if (Array.isArray(item)) visitArray(item, depth);
        else visitObject(item, depth);
      }
      visit(value, 0);
    }
    function isObject(value) {
      return value && typeof value === "object" && !Array.isArray(value);
    }
    function isPendingDelete(action) {
      return action.getString("status") === "pending" &&
        action.getString("attempt_token") === String(requestBody.admin_action_attempt_token || "") &&
        action.getString("target_collection") === "partners" &&
        action.getString("operation_kind") === "partner.delete" &&
        action.getString("operation_kind") === String(requestBody.admin_action_operation_kind || "") &&
        action.getString("target_id") === targetId;
    }
    function deleteInputMismatch(action, normalizedInput) {
      return !isObject(normalizedInput) ||
        normalizedInput.id !== targetId ||
        normalizedInput.expectedVersion !== String(requestBody.expected_version || "") ||
        $security.sha256(canonicalJson({
          targetCollection: "partners",
          targetId,
          normalizedInput,
        })) !== action.getString("input_fingerprint");
    }
    const action = txApp.findRecordById("admin_actions", String(requestBody.admin_action_id || ""));
    if (!isPendingDelete(action)) {
      throw new BadRequestError("Partner Admin Action attempt is no longer active.");
    }
    const normalizedInput = parseJson(requestBody.admin_action_normalized_input, null);
    if (deleteInputMismatch(action, normalizedInput)) {
      throw new BadRequestError("Partner delete input does not match its reservation.");
    }
    const beforeSummary = parseJson(requestBody.admin_action_before_summary, null);
    const afterSummary = parseJson(requestBody.admin_action_after_summary, null);
    const replayResult = parseJson(requestBody.admin_action_replay_result, null);
    if (isObject(replayResult)) replayResult.targetId = targetId;
    assertPayload(beforeSummary, "Admin Action before summary", 2048);
    assertPayload(afterSummary, "Admin Action after summary", 2048);
    assertPayload(replayResult, "Admin Action replay result", 32768);
    action.set("target_id", targetId);
    action.set("status", "applied");
    action.set("before_summary", beforeSummary);
    action.set("after_summary", afterSummary);
    action.set("replay_result", replayResult);
    action.set("lease_expires_at", "");
    action.set("completed_at", new Date().toISOString());
    txApp.save(action);
  }
  const request = e.requestInfo();
  const expectedVersion = String(request.body.expected_version || "");
  const separator = expectedVersion.lastIndexOf("|");
  if (separator < 1 || separator === expectedVersion.length - 1) {
    throw new BadRequestError("Partner deletion requires expected_version.");
  }
  const expectedTimestamp = expectedVersion.slice(0, separator);
  const expectedToken = expectedVersion.slice(separator + 1);
  let result;
  $app.runInTransaction((txApp) => {
    const id = e.request.pathValue("id");
    const claimed = txApp.db().newQuery(`
      UPDATE partners
      SET mutation_token = {:nextToken}
      WHERE id = {:id} AND updated = {:expectedTimestamp} AND mutation_token = {:expectedToken}
    `).bind({
      id,
      expectedTimestamp,
      expectedToken,
      nextToken: $security.randomString(32),
    }).execute();
    if (claimed.rowsAffected() !== 1) {
      result = { success: false, current: responseRecord(txApp.findRecordById("partners", id)) };
      return;
    }
    txApp.delete(txApp.findRecordById("partners", id));
    completeAction(txApp, request.body, id);
    result = { success: true };
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

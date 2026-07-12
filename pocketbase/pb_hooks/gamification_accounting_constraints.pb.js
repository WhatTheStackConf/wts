/// <reference path="../pb_data/types.d.ts" />

const immutableAccountingCollections = [
  "gamification_achievements",
  "gamification_missions",
  "gamification_activities",
  "gamification_score_schedules",
  "gamification_score_schedule_policies",
  "gamification_score_schedule_caps",
  "gamification_codes",
  "gamification_code_redemptions",
  "gamification_activity_claims",
  "gamification_user_achievements",
  "gamification_xp_events",
  "gamification_admin_actions",
  "gamification_hievents_sync_runs",
  "partner_contact_consents",
  "partner_contact_disclosures",
];

onRecordDelete((e) => {
  throw new BadRequestError("Gamification accounting history is retained; void or revoke it instead.");
}, ...immutableAccountingCollections);

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (!original.id) return e.next();

  const immutableFields = [
    "user",
    "code",
    "activity",
    "status",
    "redeemed_at",
    "idempotency_key",
    "source_hint",
    "request_fingerprint",
    "lookup_prefix",
    "hash_version",
    "metadata",
  ];
  for (const field of immutableFields) {
    if (JSON.stringify(original.get(field)) !== JSON.stringify(record.get(field))) {
      throw new BadRequestError("Code Redemption history is immutable after recording.");
    }
  }
  const originalClaim = original.getString("activity_claim");
  const nextClaim = record.getString("activity_claim");
  if (originalClaim || !nextClaim || record.getString("status") !== "accepted") {
    throw new BadRequestError("Only an accepted Code Redemption may be linked to its Activity Claim once.");
  }
  return e.next();
}, "gamification_code_redemptions");

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (!original.id) return e.next();

  const immutableFields = [
    "key",
    "label",
    "activity",
    "lookup_prefix",
    "code_hash",
    "hash_version",
    "evidence_role",
    "starts_at",
    "ends_at",
    "max_redemptions",
    "per_user_limit",
    "created_by",
    "batch_id",
    "reissued_from",
    "metadata",
  ];
  for (const field of immutableFields) {
    if (JSON.stringify(original.get(field)) !== JSON.stringify(record.get(field))) {
      throw new BadRequestError("Mission Code identity and secret material are immutable after generation.");
    }
  }
  if (record.getInt("total_redemptions_cached") < original.getInt("total_redemptions_cached")) {
    throw new BadRequestError("Mission Code redemption totals cannot decrease.");
  }
  const statusChanged = original.getString("status") !== record.getString("status") ||
    original.getBool("enabled") !== record.getBool("enabled");
  const invalidationFields = ["invalidated_at", "invalidated_by", "invalidated_reason"];
  const invalidationChanged = invalidationFields.some((field) =>
    JSON.stringify(original.get(field)) !== JSON.stringify(record.get(field))
  );
  if (invalidationChanged && !statusChanged) {
    throw new BadRequestError("Mission Code invalidation history is immutable after the disable transition.");
  }
  if (statusChanged && (
    original.getString("status") !== "active" ||
    record.getString("status") !== "disabled" ||
    record.getBool("enabled") ||
    !record.getString("invalidated_at") ||
    !record.getString("invalidated_by") ||
    !record.getString("invalidated_reason")
  )) {
    throw new BadRequestError("Mission Codes may only transition once from active to an audited disabled state.");
  }
  if (original.getString("status") === "disabled" && statusChanged) {
    throw new BadRequestError("A disabled Mission Code cannot be reactivated.");
  }
  return e.next();
}, "gamification_codes");

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (!original.id) return e.next();

  const immutableFields = [
    "user",
    "activity",
    "source_type",
    "source_collection",
    "source_record_id",
    "outcome_key",
    "occurred_at",
    "claimed_at",
    "evidence_fingerprint",
    "idempotency_key",
    "cap_outcome",
    "metadata",
  ];
  for (const field of immutableFields) {
    if (JSON.stringify(original.get(field)) !== JSON.stringify(record.get(field))) {
      throw new BadRequestError("Activity Claims are immutable evidence; void the claim instead.");
    }
  }
  if (original.getString("status") === "voided") {
    throw new BadRequestError("A voided Activity Claim cannot be changed.");
  }
  if (record.getString("status") !== "voided") {
    throw new BadRequestError("Activity Claim updates may only record an audited void.");
  }
  if (!record.getString("voided_by") || !record.getString("void_reason") || !record.getString("void_admin_action")) {
    throw new BadRequestError("An Activity Claim void requires an actor, reason, and admin audit action.");
  }
  return e.next();
}, "gamification_activity_claims");

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (!original.id) return e.next();

  const immutableFields = [
    "user",
    "amount",
    "leaderboard_amount",
    "category",
    "reason",
    "source_type",
    "source_claim",
    "user_achievement",
    "source_id",
    "idempotency_key",
    "occurred_at",
    "metadata",
  ];
  for (const field of immutableFields) {
    if (JSON.stringify(original.get(field)) !== JSON.stringify(record.get(field))) {
      throw new BadRequestError("XP Events are append-only; create a correction or void this event.");
    }
  }
  if (original.getBool("voided")) {
    throw new BadRequestError("A voided XP Event cannot be changed.");
  }
  if (!record.getBool("voided")) {
    throw new BadRequestError("XP Events may only be updated to record an audited void.");
  }
  if (!record.getString("voided_by") || !record.getString("void_reason") || !record.getString("void_admin_action")) {
    throw new BadRequestError("An XP Event void requires an actor, reason, and admin audit action.");
  }
  return e.next();
}, "gamification_xp_events");

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (!original.id) return e.next();

  const immutableFields = [
    "user",
    "achievement",
    "unlocked_at",
    "source_claim",
    "idempotency_key",
    "metadata",
  ];
  for (const field of immutableFields) {
    if (JSON.stringify(original.get(field)) !== JSON.stringify(record.get(field))) {
      throw new BadRequestError("Badge unlock history is immutable; revoke the Badge instead.");
    }
  }
  if (original.getString("status") === "revoked") {
    throw new BadRequestError("A revoked Badge cannot be changed.");
  }
  if (record.getString("status") === "unlocked") {
    // Public visibility is a User preference, not a change to the Badge unlock history.
    const correctionFields = ["source_admin_action", "revoked_at", "revoked_by", "revoked_reason"];
    for (const field of correctionFields) {
      if (JSON.stringify(original.get(field)) !== JSON.stringify(record.get(field))) {
        throw new BadRequestError("Only public Badge visibility may change before an audited revocation.");
      }
    }
    return e.next();
  }
  if (record.getString("status") !== "revoked") {
    throw new BadRequestError("User Achievement updates may only record an audited Badge revocation.");
  }
  if (!record.getString("revoked_by") || !record.getString("revoked_reason")) {
    throw new BadRequestError("A Badge revocation requires an actor and reason.");
  }
  return e.next();
}, "gamification_user_achievements");

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (!original.id) return e.next();

  const immutableFields = [
    "actor",
    "actor_role",
    "target_user",
    "action",
    "reason",
    "correlation_id",
    "idempotency_key",
    "related_collection",
    "related_record_id",
    "before_summary",
    "after_summary",
    "metadata",
  ];
  for (const field of immutableFields) {
    if (JSON.stringify(original.get(field)) !== JSON.stringify(record.get(field))) {
      throw new BadRequestError("Gamification admin actions are immutable once recorded.");
    }
  }
  const originalStatus = original.getString("status");
  const nextStatus = record.getString("status");
  const resolvesPending = originalStatus === "rebuild_pending" && ["applied", "failed"].includes(nextStatus);
  const retriesFailure = originalStatus === "failed" && nextStatus === "rebuild_pending";
  if (!resolvesPending && !retriesFailure) {
    throw new BadRequestError("Admin action status may only resolve a pending accounting operation.");
  }
  return e.next();
}, "gamification_admin_actions");

onRecordValidate((e) => {
  if (e.record.original().id) {
    throw new BadRequestError("Hi.Events reconciliation runs are append-only source history.");
  }
  return e.next();
}, "gamification_hievents_sync_runs");

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (!original.id) {
    if (record.getString("state") !== "granted" || !record.getString("granted_at") || record.getString("withdrawn_at")) {
      throw new BadRequestError("Partner contact consent must begin as an explicit grant.");
    }
    return e.next();
  }

  const immutableFields = ["user", "partner", "activity", "purpose", "notice_version", "approved_fields", "granted_at"];
  for (const field of immutableFields) {
    if (JSON.stringify(original.get(field)) !== JSON.stringify(record.get(field))) {
      throw new BadRequestError("Partner contact consent identity is immutable.");
    }
  }
  if (original.getString("state") !== "granted" || record.getString("state") !== "withdrawn" || !record.getString("withdrawn_at")) {
    throw new BadRequestError("Partner contact consent may only be withdrawn once.");
  }
  return e.next();
}, "partner_contact_consents");

onRecordValidate((e) => {
  const record = e.record;
  if (record.original().id) {
    throw new BadRequestError("Partner contact disclosure history is immutable.");
  }
  const consent = e.app.findRecordById("partner_contact_consents", record.getString("consent"));
  if (
    consent.getString("state") !== "granted" ||
    consent.getString("user") !== record.getString("user") ||
    consent.getString("partner") !== record.getString("partner") ||
    consent.getString("activity") !== record.getString("activity") ||
    consent.getString("purpose") !== record.getString("purpose")
  ) {
    throw new BadRequestError("Partner contact disclosure requires a current matching consent grant.");
  }
  return e.next();
}, "partner_contact_disclosures");

function isAvailable(app, capability) {
  try {
    const records = app.findRecordsByFilter("conference_config", "", "", 2, 0);
    if (records.length !== 1 || typeof records[0].get("cfp_open") !== "boolean") return false;
    const availability = JSON.parse(toString(records[0].get("availability")));
    return availability && typeof availability === "object" &&
      typeof availability.cfp === "boolean" && typeof availability.review === "boolean" &&
      availability[capability] === true && (capability !== "cfp" || records[0].get("cfp_open") === true);
  } catch (_) {
    return false;
  }
}

function hasExpandPath(event, relation) {
  try {
    const expand = event.requestInfo().query.expand;
    return typeof expand === "string" && expand.split(",").some((path) =>
      path.split(".").includes(relation));
  } catch (_) {
    return false;
  }
}

function unavailable() {
  throw new NotFoundError("Capability unavailable.", { code: "capability_unavailable" });
}

function rejectUnavailable(event, capability) {
  if (!isAvailable(event.app, capability)) unavailable();
  return event.next();
}

function canReadSubmissionForReview(requestInfo) {
  if (requestInfo.hasSuperuserAuth()) return true;
  const auth = requestInfo.auth;
  if (!auth || auth.collection().name !== "users") return false;
  const role = auth.getString("role");
  return role === "admin" || role === "reviewer";
}

function rejectSubmissionRead(event) {
  if (isAvailable(event.app, "cfp")) return event.next();
  if (isAvailable(event.app, "review") && canReadSubmissionForReview(event.requestInfo())) return event.next();
  unavailable();
}

function rejectUnavailableSpeakerApplicantExpansion(event) {
  if (hasExpandPath(event, "cfp_applicant") && !isAvailable(event.app, "cfp")) unavailable();
  return event.next();
}

const expansionCapabilities = {
  cfp_applicants: "cfp",
  cfp_submissions: "cfp",
  cfp_reviews: "review",
  cfp_weight_votes: "review",
};

function expansionCapability(collection) {
  return Object.prototype.hasOwnProperty.call(expansionCapabilities, collection) ? expansionCapabilities[collection] : "";
}

function canExpandSubmission(app, requestInfo) {
  return isAvailable(app, "cfp") || (isAvailable(app, "review") && canReadSubmissionForReview(requestInfo));
}

function rejectUnavailableExpansion(event) {
  const collection = event.record.collection().name;
  const requestInfo = event.requestInfo;
  if (requestInfo && requestInfo.context !== "expand") return event.next();
  const capability = expansionCapability(collection);
  if (requestInfo && collection === "cfp_submissions") {
    if (!canExpandSubmission(event.app, requestInfo)) unavailable();
  } else if (capability && !isAvailable(event.app, capability)) {
    unavailable();
  }
  return event.next();
}

module.exports = {
  isAvailable,
  rejectSubmissionRead,
  rejectUnavailable,
  rejectUnavailableExpansion,
  rejectUnavailableSpeakerApplicantExpansion,
};


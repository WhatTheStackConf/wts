/// <reference path="../pb_data/types.d.ts" />
// This capability endpoint never reads e.auth/cookies or records request metadata.
// Success logging is disabled here. PB failure logs / proxy access logs can still
// contain IP, time and path: deployers must review their retention/redaction.
// Never put tokens in URLs, print request bodies, or log caught exceptions.
routerAdd("POST", "/api/wts/feedback", (e) => {
  e.response.header().set("Cache-Control", "no-store");
  e.response.header().set("Referrer-Policy", "no-referrer");
  e.response.header().set("X-Robots-Tag", "noindex, nofollow");
  const reply = (state) => e.json(200, { state });
  const rejectsTransport = () => e.request.header.get("Origin") || e.request.header.get("Sec-Fetch-Site") === "cross-site" ||
    e.request.header.get("Content-Type").split(";")[0].trim().toLowerCase() !== "application/json";
  const readBody = () => {
    try {
      const raw = toString(e.request.body, 4194305);
      if (raw.length > 4194304) return { replied: true, response: reply("invalid_answers") };
      return { body: JSON.parse(raw) };
    } catch (_) { return { replied: true, response: reply("invalid") }; }
  };
  const invalidRequest = (body, validation) => !body || !validation.object(body, body.action === "inspect" ? ["action", "token"] : ["action", "token", "version", "answers"]) || !["inspect", "submit"].includes(body.action) || typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token);
  const invitationState = (found, now) => {
    if (!found.length || found[0].getBool("revoked")) return "invalid";
    if (found[0].getBool("used")) return "used";
    const expiry = Date.parse(found[0].getString("expires_at"));
    if (!Number.isFinite(expiry) || now >= expiry) return "expired";
    return "";
  };
  const surveyClosed = (survey, now) => {
    const opens = Date.parse(survey.getString("opens_at")), closes = Date.parse(survey.getString("closes_at"));
    return !survey.getBool("open") || !Number.isFinite(opens) || !Number.isFinite(closes) || now < opens || now >= closes;
  };
  const submit = (tx, invitation, survey, answers) => {
    invitation.set("used", true);
    tx.save(invitation);
    const response = new Record(tx.findCollectionByNameOrId("feedback_responses"));
    response.set("survey", survey.id);
    response.set("version", survey.getString("version"));
    response.set("answers", answers);
    tx.save(response);
    return { state: "submitted" };
  };
  const respond = (tx, body, validation) => {
    const found = tx.findRecordsByFilter("feedback_invitations", "token_hash = {:hash}", "", 1, 0, { hash: $security.sha256(body.token) });
    const now = Date.now();
    const unusable = invitationState(found, now);
    if (unusable) return { state: unusable };
    const invitation = found[0];
    const survey = tx.findRecordById("feedback_surveys", invitation.getString("survey"));
    if (surveyClosed(survey, now)) return { state: "closed" };
    const sessions = JSON.parse(survey.getString("sessions"));
    if (body.action === "inspect") {
      return { state: "ready", survey: { title: survey.getString("title"), version: survey.getString("version"), closesAt: survey.getString("closes_at"), sessions } };
    }
    const answers = validation.answers(body.answers, sessions);
    if (body.version !== survey.getString("version") || !answers) return { state: "invalid_answers" };
    return submit(tx, invitation, survey, answers);
  };
  try {
    // A single atomic, process-local bucket: bounded memory, no IP/token keys,
    // no persisted client identity. This load-shedding limit is shared by all
    // respondents; it is not DDoS protection and resets on process restart.
    let allowed = false;
    const now = Date.now();
    e.app.store().setFunc("wts.feedback.budget", (stored) => {
      const old = stored ? JSON.parse(stored) : null;
      const bucket = old && now < old.until ? old : { until: now + 60000, count: 0 };
      allowed = bucket.count < 600;
      if (allowed) bucket.count++;
      return JSON.stringify(bucket);
    });
    if (!allowed) return reply("unavailable");
    // The browser talks to the same-origin HTTP adapter. Direct PB calls are
    // server-to-server, so browser Origin headers are not accepted at this seam.
    if (rejectsTransport()) return reply("invalid");
    const parsed = readBody();
    if (parsed.replied) return parsed.response;
    const body = parsed.body;
    const validation = require(`${__hooks}/feedback-validation.js`);
    if (invalidRequest(body, validation)) return reply("invalid");
    let result = { state: "unavailable" };
    // All reads and BOTH writes use the scoped transaction. A failed response
    // insert rolls back used; competing submissions serialize at the DB boundary.
    e.app.runInTransaction((tx) => { result = respond(tx, body, validation); });
    return e.json(200, result);
  } catch (_) { return reply("unavailable"); }
}, $apis.bodyLimit(4194304), $apis.skipSuccessActivityLog());

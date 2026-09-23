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
    if (e.request.header.get("Origin") || e.request.header.get("Sec-Fetch-Site") === "cross-site") return reply("invalid");
    if (e.request.header.get("Content-Type").split(";")[0].trim().toLowerCase() !== "application/json") return reply("invalid");
    let body;
    try {
      const raw = toString(e.request.body, 4194305);
      if (raw.length > 4194304) return reply("invalid_answers");
      body = JSON.parse(raw);
    } catch (_) { return reply("invalid"); }
    const validation = require(`${__hooks}/feedback-validation.js`);
    if (!body || !validation.object(body, body.action === "inspect" ? ["action", "token"] : ["action", "token", "version", "answers"]) || !["inspect", "submit"].includes(body.action) || typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return reply("invalid");
    let result = { state: "unavailable" };
    // All reads and BOTH writes use the scoped transaction. A failed response
    // insert rolls back used; competing submissions serialize at the DB boundary.
    e.app.runInTransaction((tx) => {
      const found = tx.findRecordsByFilter("feedback_invitations", "token_hash = {:hash}", "", 1, 0, { hash: $security.sha256(body.token) });
      if (!found.length || found[0].getBool("revoked")) { result = { state: "invalid" }; return; }
      const invitation = found[0];
      if (invitation.getBool("used")) { result = { state: "used" }; return; }
      const now = Date.now(), expiry = Date.parse(invitation.getString("expires_at"));
      if (!Number.isFinite(expiry) || now >= expiry) { result = { state: "expired" }; return; }
      const survey = tx.findRecordById("feedback_surveys", invitation.getString("survey"));
      const opens = Date.parse(survey.getString("opens_at")), closes = Date.parse(survey.getString("closes_at"));
      if (!survey.getBool("open") || !Number.isFinite(opens) || !Number.isFinite(closes) || now < opens || now >= closes) { result = { state: "closed" }; return; }
      const sessions = JSON.parse(survey.getString("sessions"));
      if (body.action === "inspect") {
        result = { state: "ready", survey: { title: survey.getString("title"), version: survey.getString("version"), closesAt: survey.getString("closes_at"), sessions } };
        return;
      }
      const answers = validation.answers(body.answers, sessions);
      if (body.version !== survey.getString("version") || !answers) { result = { state: "invalid_answers" }; return; }
      invitation.set("used", true);
      tx.save(invitation);
      const response = new Record(tx.findCollectionByNameOrId("feedback_responses"));
      response.set("survey", survey.id);
      response.set("version", survey.getString("version"));
      response.set("answers", answers);
      tx.save(response);
      result = { state: "submitted" };
    });
    return e.json(200, result);
  } catch (_) { return reply("unavailable"); }
}, $apis.bodyLimit(4194304), $apis.skipSuccessActivityLog());

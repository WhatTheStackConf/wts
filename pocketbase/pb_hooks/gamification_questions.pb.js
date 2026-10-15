/// <reference path="../pb_data/types.d.ts" />
onRecordValidate((e) => {
  const isIdentifier = (value) => typeof value === "string" && /^[a-z][a-z0-9_-]{0,39}$/.test(value);
  const unknownKeys = (value, keys) => Object.keys(value).some(k => !keys.includes(k));
  const isDraftCompletionActivity = (activity) => activity.getString("status") === "draft" && activity.getString("kind") === "qr" && activity.getString("evidence_mode") === "single_code" && activity.getString("outcome_key") === "completion";
  const invalidDefinition = (d) => !d || !["all_answered", "all_correct", "correct_or_half"].includes(d.policy) || !Array.isArray(d.questions) || d.questions.length < 1 || d.questions.length > 10 || unknownKeys(d, ["policy", "questions"]);
  const invalidQuestion = (q, ids) => !q || !isIdentifier(q.id) || ids[q.id] || !["text", "single_choice"].includes(q.kind) || typeof q.prompt !== "string" || !q.prompt.trim() || q.prompt.length > 500 || unknownKeys(q, ["id", "kind", "prompt", "choices", "acceptedAnswers"]);
  const invalidAnswerText = (a) => typeof a !== "string" || !a.trim() || a.length > 1000;
  const invalidAcceptedAnswers = (q, policy) => !Array.isArray(q.acceptedAnswers) || q.acceptedAnswers.length > 8 || q.acceptedAnswers.some(invalidAnswerText) || (policy !== "all_answered" && !q.acceptedAnswers.length);
  const invalidChoice = (c, choices) => !c || !isIdentifier(c.id) || choices[c.id] || typeof c.label !== "string" || !c.label.trim() || c.label.length > 200 || unknownKeys(c, ["id", "label"]);
  const assertChoices = (q) => {
    if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 8) throw new BadRequestError("Invalid choices.");
    const choices = {};
    for (const c of q.choices) {
      if (invalidChoice(c, choices)) throw new BadRequestError("Invalid choice.");
      choices[c.id] = true;
    }
    if (q.acceptedAnswers.some(a => !choices[a])) throw new BadRequestError("Accepted choice does not exist.");
  };
  const assertQuestion = (q, ids, policy) => {
    if (invalidQuestion(q, ids)) throw new BadRequestError("Invalid question.");
    ids[q.id] = true;
    if (invalidAcceptedAnswers(q, policy)) throw new BadRequestError("Invalid private accepted answers.");
    if (q.kind === "text" && q.choices !== undefined) throw new BadRequestError("Text questions cannot have choices.");
    if (q.kind === "single_choice") assertChoices(q);
  };
  const assertNoEvidence = (activity) => {
    for (const collection of ["gamification_codes", "gamification_activity_claims", "gamification_question_attempts"]) {
      if (e.app.findRecordsByFilter(collection, "activity = {:activity}", "", 1, 0, { activity: activity.id }).length) throw new BadRequestError("Questions cannot change after codes or evidence exist.");
    }
  };
  const r = e.record, old = r.original();
  const activity = e.app.findRecordById("gamification_activities", r.getString("activity"));
  if (old.id && old.getString("activity") !== r.getString("activity")) throw new BadRequestError("Questionnaire Activity is immutable.");
  if (!isDraftCompletionActivity(activity)) throw new BadRequestError("Questions require a draft single-code QR completion Activity.");
  assertNoEvidence(activity);
  if (old.id && (old.getString("version") === r.getString("version") || old.getString("operation_id") === r.getString("operation_id"))) throw new BadRequestError("Question changes require a new version and operation.");
  const d = JSON.parse(r.getString("definition") || "null");
  if (invalidDefinition(d)) throw new BadRequestError("Invalid questionnaire.");
  const ids = {};
  for (const q of d.questions) assertQuestion(q, ids, d.policy);
  return e.next();
}, "gamification_questionnaires");

onRecordValidate((e) => {
  const r = e.record, old = r.original();
  if (old.id && old.getString("status") !== "draft" && r.getString("status") === "draft" && e.app.findRecordsByFilter("gamification_questionnaires", "activity = {:activity}", "", 1, 0, { activity: r.id }).length) throw new BadRequestError("Published question Activities cannot return to draft.");
  const questions = e.app.findRecordsByFilter("gamification_questionnaires", "activity = {:activity}", "", 1, 0, { activity: r.id });
  if (questions.length && (r.getString("kind") !== "qr" || r.getString("evidence_mode") !== "single_code" || r.getString("outcome_key") !== "completion")) throw new BadRequestError("Question Activity identity cannot change.");
  return e.next();
}, "gamification_activities");

onRecordValidate((e) => {
  const isMissionActive = (code, activity) => code.getBool("enabled") && code.getString("status") === "active" && !code.getString("invalidated_at") && activity.getBool("enabled") && activity.getString("status") === "active";
  const bindingMismatch = (r, code, activity, definition) => code.getString("activity") !== activity.id || definition.getString("activity") !== activity.id || definition.getString("version") !== r.getString("version");
  const assertAnsweredChallenge = (r, old) => {
    for (const field of ["challenge_id", "user", "code", "activity", "questionnaire", "version", "opened_at", "expires_at"]) if (JSON.stringify(old.get(field)) !== JSON.stringify(r.get(field))) throw new BadRequestError("Question challenge binding is immutable.");
    if (old.getString("status") !== "pending" || r.getString("status") === "pending" || !r.getString("operation_id") || !/^[a-f0-9]{64}$/.test(r.getString("answer_hash"))) throw new BadRequestError("Question answer evidence is immutable.");
  };
  const assertAttemptTransition = (r, old) => {
    if (old.id) assertAnsweredChallenge(r, old);
    else if (r.getString("status") !== "pending" || r.getString("operation_id") || r.getString("answer_hash") || r.getString("passed_at")) throw new BadRequestError("Challenges must start pending.");
  };
  const assertWithinMissionWindow = (expiry, code, activity) => {
    for (const end of [code.getString("ends_at"), activity.getString("active_until")]) if (end && expiry > Date.parse(end)) throw new BadRequestError("Challenge exceeds Mission window.");
  };
  const invalidChallengeWindow = (expiry, opened) => !Number.isFinite(expiry) || !Number.isFinite(opened) || expiry <= opened || expiry - opened > 900000 || expiry <= Date.now();
  const invalidPassedAt = (r, opened, expiry) => !r.getString("passed_at") || Date.parse(r.getString("passed_at")) < opened || Date.parse(r.getString("passed_at")) >= expiry;
  const r = e.record, old = r.original();
  const code = e.app.findRecordById("gamification_codes", r.getString("code"));
  const activity = e.app.findRecordById("gamification_activities", r.getString("activity"));
  const definition = e.app.findRecordById("gamification_questionnaires", r.getString("questionnaire"));
  if (bindingMismatch(r, code, activity, definition)) throw new BadRequestError("Question binding mismatch.");
  assertAttemptTransition(r, old);
  const expiry = Date.parse(r.getString("expires_at")), opened = Date.parse(r.getString("opened_at"));
  if (invalidChallengeWindow(expiry, opened)) throw new BadRequestError("Question challenge expired or exceeds 15 minutes.");
  assertWithinMissionWindow(expiry, code, activity);
  if (!isMissionActive(code, activity)) throw new BadRequestError("Mission is inactive.");
  const policy = JSON.parse(definition.getString("definition")).policy;
  if (r.getString("status") === "passed_half" && policy !== "correct_or_half") throw new BadRequestError("Half credit requires the correct-or-half policy.");
  if (["passed", "passed_half"].includes(r.getString("status")) && invalidPassedAt(r, opened, expiry)) throw new BadRequestError("Invalid approved evidence time.");
  return e.next();
}, "gamification_question_attempts");

// Fail closed even for a privileged caller accidentally attempting the old direct path.
onRecordValidate((e) => {
  const isBoundActiveMission = (code, activity) => code.getString("activity") === activity.id && code.getBool("enabled") && code.getString("status") === "active" && !code.getString("invalidated_at") && activity.getBool("enabled") && activity.getString("status") === "active";
  const findApprovedEvidence = (r, definition, finalOutcome) => e.app.findRecordsByFilter("gamification_question_attempts", "user = {:user} && code = {:code} && questionnaire = {:definition} && version = {:version} && (status = 'passed' || status = 'passed_half')" + (finalOutcome ? "" : " && expires_at > {:now}"), finalOutcome ? "passed_at,id" : "-expires_at,id", 1, 0, { user: r.getString("user"), code: r.getString("code"), definition: definition.id, version: definition.getString("version"), now: new Date().toISOString().replace("T", " ") });
  const assertMissionOpen = (code, activity) => {
    if (!isBoundActiveMission(code, activity)) throw new BadRequestError("Mission is inactive.");
    if (activity.getString("mission") && e.app.findRecordById("gamification_missions", activity.getString("mission")).getString("status") !== "active") throw new BadRequestError("Mission is inactive.");
    for (const end of [code.getString("ends_at"), activity.getString("active_until")]) if (end && Date.parse(end) <= Date.now()) throw new BadRequestError("Mission expired.");
  };
  const r = e.record;
  if (r.original().id || r.getString("status") !== "accepted") return e.next();
  const definitions = e.app.findRecordsByFilter("gamification_questionnaires", "activity = {:activity}", "", 1, 0, { activity: r.getString("activity") });
  if (!definitions.length) return e.next();
  const finalOutcome = JSON.parse(definitions[0].getString("definition")).policy === "correct_or_half";
  // Match the service gate: the first correct-or-half result survives challenge
  // expiry; legacy policies still require unexpired approved evidence.
  const evidence = findApprovedEvidence(r, definitions[0], finalOutcome);
  if (!evidence.length) throw new BadRequestError("Approved question evidence is required.");
  // Bind immutable accounting history to the server-selected terminal outcome.
  // Existing accounting constraints forbid changing metadata after creation.
  const metadata = JSON.parse(r.getString("metadata") || "{}");
  if (metadata.question_attempt && metadata.question_attempt !== evidence[0].id) throw new BadRequestError("Question evidence does not match the approved attempt.");
  metadata.question_attempt = evidence[0].id;
  r.set("metadata", metadata);
  const code = e.app.findRecordById("gamification_codes", r.getString("code"));
  const activity = e.app.findRecordById("gamification_activities", r.getString("activity"));
  assertMissionOpen(code, activity);
  return e.next();
}, "gamification_code_redemptions");

onRecordDelete(() => { throw new BadRequestError("Question definitions and completion evidence are retained."); }, "gamification_questionnaires", "gamification_question_attempts");
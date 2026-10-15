// Public answer vocabulary mirrors src/lib/feedback-contract.ts; contract tests
// exercise every option against the real Goja endpoint (not a second JS mock).
function object(value, keys) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
}
function rating(value) { return Number.isInteger(value) && value >= 1 && value <= 5; }
function text(value, max) { return typeof value === "string" && value.length <= max; }
function invalidParts(parts) {
  return !object(parts, ["content", "organisation", "venue", "connections"]) || Object.keys(parts).some(k => parts[k] !== "na" && !rating(parts[k]));
}
function invalidTexts(a) { return !text(a.keep, 2000) || !text(a.change, 2000) || !text(a.moreOther, 500); }
function invalidMore(a) {
  const more = ["technical", "case_studies", "demos", "discussion", "beginner", "workshops", "meeting", "other"];
  return !Array.isArray(a.more) || a.more.length > 3 || a.more.some((v, i) => !more.includes(v) || a.more.indexOf(v) !== i) || (a.moreOther !== "" && !a.more.includes("other"));
}
function invalidSessionFeedback(s, comment) {
  return !text(comment, 2000) || (s.usefulness !== undefined && !rating(s.usefulness)) || (s.usefulness === undefined && !comment.trim());
}
function sessionAnswer(s, ids, seen) {
  if (!object(s, ["sessionId", "usefulness", "comment"]) || !ids.includes(s.sessionId) || seen.includes(s.sessionId)) return null;
  const comment = s.comment === undefined ? "" : s.comment;
  if (invalidSessionFeedback(s, comment)) return null;
  seen.push(s.sessionId);
  const normalized = { sessionId: s.sessionId, comment };
  if (s.usefulness !== undefined) normalized.usefulness = s.usefulness;
  return normalized;
}
function sessionAnswers(list, frozenSessions) {
  if (!Array.isArray(list) || list.length > frozenSessions.length) return null;
  const ids = frozenSessions.map(s => s.id), seen = [];
  const sessions = [];
  for (const s of list) {
    const normalized = sessionAnswer(s, ids, seen);
    if (!normalized) return null;
    sessions.push(normalized);
  }
  return sessions;
}
function answers(input, frozenSessions) {
  if (!object(input, ["overall", "parts", "keep", "change", "more", "moreOther", "sessions"]) || !rating(input.overall)) return null;
  const a = Object.assign({ parts: {}, keep: "", change: "", more: [], moreOther: "", sessions: [] }, input);
  if (invalidParts(a.parts) || invalidTexts(a) || invalidMore(a)) return null;
  const sessions = sessionAnswers(a.sessions, frozenSessions);
  if (!sessions) return null;
  return { overall: a.overall, parts: a.parts, keep: a.keep, change: a.change, more: a.more, moreOther: a.moreOther, sessions };
}
module.exports = { object, answers };

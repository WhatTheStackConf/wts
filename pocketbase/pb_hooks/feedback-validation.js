// Public answer vocabulary mirrors src/lib/feedback-contract.ts; contract tests
// exercise every option against the real Goja endpoint (not a second JS mock).
function object(value, keys) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
}
function rating(value) { return Number.isInteger(value) && value >= 1 && value <= 5; }
function text(value, max) { return typeof value === "string" && value.length <= max; }
function answers(input, frozenSessions) {
  if (!object(input, ["overall", "parts", "keep", "change", "more", "moreOther", "sessions"]) || !rating(input.overall)) return null;
  const a = Object.assign({ parts: {}, keep: "", change: "", more: [], moreOther: "", sessions: [] }, input);
  if (!object(a.parts, ["content", "organisation", "venue", "connections"]) || Object.keys(a.parts).some(k => a.parts[k] !== "na" && !rating(a.parts[k]))) return null;
  if (!text(a.keep, 2000) || !text(a.change, 2000) || !text(a.moreOther, 500)) return null;
  const more = ["technical", "case_studies", "demos", "discussion", "beginner", "workshops", "meeting", "other"];
  if (!Array.isArray(a.more) || a.more.length > 3 || a.more.some((v, i) => !more.includes(v) || a.more.indexOf(v) !== i) || (a.moreOther !== "" && !a.more.includes("other"))) return null;
  if (!Array.isArray(a.sessions) || a.sessions.length > frozenSessions.length) return null;
  const ids = frozenSessions.map(s => s.id), seen = [];
  const sessions = [];
  for (const s of a.sessions) {
    if (!object(s, ["sessionId", "usefulness", "comment"]) || !ids.includes(s.sessionId) || seen.includes(s.sessionId)) return null;
    const comment = s.comment === undefined ? "" : s.comment;
    if (!text(comment, 2000) || (s.usefulness !== undefined && !rating(s.usefulness)) || (s.usefulness === undefined && !comment.trim())) return null;
    seen.push(s.sessionId);
    const normalized = { sessionId: s.sessionId, comment };
    if (s.usefulness !== undefined) normalized.usefulness = s.usefulness;
    sessions.push(normalized);
  }
  return { overall: a.overall, parts: a.parts, keep: a.keep, change: a.change, more: a.more, moreOther: a.moreOther, sessions };
}
module.exports = { object, answers };

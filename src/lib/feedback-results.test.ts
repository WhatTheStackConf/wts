import { describe, expect, it } from "vite-plus/test";
import { aggregateFeedback } from "./feedback-results";
const survey = { title: "Main day", version: "v1", sessions: [{ id: "a", title: "Four ratings" }, { id: "b", title: "Five ratings" }] };
const answer = (overall = 4) => ({ overall, parts: {}, keep: "", change: "", more: [], moreOther: "", sessions: [] });
describe("organizer feedback aggregation", () => {
  it("counts only answered categories and preserves empty scores as null", () => {
    const result = aggregateFeedback(survey, [answer(5), { ...answer(3), parts: { content: 2, venue: "na" } }]);
    expect(result.overall).toEqual({ count: 2, mean: 4, distribution: [0, 0, 1, 0, 1] });
    expect(result.parts[0].score).toEqual({ count: 1, mean: 2, distribution: [0, 1, 0, 0, 0] });
    expect(result.parts[2]).toMatchObject({ notApplicable: 1, skipped: 1 });
    expect(result.parts[0]).toMatchObject({ notApplicable: 0, skipped: 1 });
    expect(result.parts[2].score).toEqual({ count: 0, mean: null, distribution: [0, 0, 0, 0, 0] });
  });
  it("suppresses every numeric session field below five ratings, regardless of comments", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ ...answer(), sessions: [
      { sessionId: "a", ...(i < 4 ? { usefulness: 1 } : {}), comment: "Private comment" },
      { sessionId: "b", ...(i < 5 ? { usefulness: 5 } : {}), comment: "Another comment" },
    ] }));
    const result = aggregateFeedback(survey, rows);
    expect(result.sessions[0]).toEqual({ title: "Four ratings", score: null, comments: Array(6).fill("Private comment") });
    expect(result.sessions[1].score).toEqual({ count: 5, mean: 5, distribution: [0, 0, 0, 0, 5] });
  });
  it("returns only unlinked comments and option counts, not raw response metadata", () => {
    const result = aggregateFeedback(survey, [{ ...answer(), keep: "<img src=x onerror=alert(1)>", change: "More time", more: ["other", "technical"], moreOther: "Coffee" }]);
    expect(result.comments.map(g => g.comments)).toEqual([["<img src=x onerror=alert(1)>"], ["More time"], ["Coffee"]]);
    expect(result.more[0].count).toBe(1);
    expect(result.more[7].count).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/sessionId|responseId|email|timestamp|source_key/);
  });
  it("represents an empty survey without invented averages", () => {
    const result = aggregateFeedback(survey, []);
    expect(result.responseCount).toBe(0);
    expect(result.overall.mean).toBeNull();
    expect(result.sessions.every(s => s.score === null)).toBe(true);
  });
  it.each([
    { ...answer(), overall: 0 }, { ...answer(), overall: "5" }, { ...answer(), parts: { venue: null } },
    { ...answer(), more: ["technical", "technical"] }, { ...answer(), email: "private@example.test" },
    { ...answer(), sessions: [{ sessionId: "missing", usefulness: 4, comment: "" }] },
    { ...answer(), sessions: [{ sessionId: "a", comment: "" }] },
    { ...answer(), sessions: [{ sessionId: "a", usefulness: 4, comment: "" }, { sessionId: "a", usefulness: 5, comment: "" }] },
  ])("fails closed on malformed or ambiguous answers", (value) => expect(() => aggregateFeedback(survey, [value])).toThrow());
});

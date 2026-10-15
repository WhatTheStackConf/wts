import { describe, expect, it } from "vite-plus/test";
import { readFeedbackAnswers, formatFeedbackDeadline } from "./form-data";

function data(entries: [string, string][] = []) {
  const form = new FormData();
  form.set("overall", "5");
  for (const [key, value] of entries) form.append(key, value);
  return form;
}
const sessions = [{ id: "talk-a", title: "Talk A" }, { id: "talk-b", title: "Talk B" }];

describe("feedback form answers", () => {
  it("accepts the only required answer and leaves all optional answers empty", () => {
    expect(readFeedbackAnswers(data(), sessions)).toEqual({ ok: true, answers: { overall: 5, parts: {}, keep: "", change: "", more: [], moreOther: "", sessions: [] } });
  });
  it("rejects missing overall and more than three preferences with field-specific errors", () => {
    const input = data([["more", "technical"], ["more", "demos"], ["more", "meeting"], ["more", "other"]]);
    input.delete("overall");
    expect(readFeedbackAnswers(input, sessions)).toMatchObject({ ok: false, errors: { overall: expect.any(String), more: expect.any(String) } });
  });
  it("distinguishes N/A from unanswered and drops stale Other text", () => {
    const result = readFeedbackAnswers(data([["part:content", "na"], ["part:venue", "3"], ["moreOther", "Hidden stale text"]]), sessions);
    expect(result).toMatchObject({ ok: true, answers: { parts: { content: "na", venue: 3 }, moreOther: "" } });
  });
  it("accepts bounded Other text only with Other selected", () => {
    expect(readFeedbackAnswers(data([["more", "other"], ["moreOther", "a".repeat(500)]]), sessions).ok).toBe(true);
    expect(readFeedbackAnswers(data([["more", "other"], ["moreOther", "a".repeat(501)]]), sessions)).toMatchObject({ ok: false, errors: { moreOther: expect.any(String) } });
  });
  it("keeps optional session scores or comments, never an empty review", () => {
    expect(readFeedbackAnswers(data([["sessionId", "talk-a"], ["sessionId", "talk-b"], ["session:talk-b:comment", "Useful examples"]]), sessions)).toMatchObject({ ok: true, answers: { sessions: [{ sessionId: "talk-b", comment: "Useful examples" }] } });
    expect(readFeedbackAnswers(data([["sessionId", "talk-a"], ["session:talk-a:usefulness", "4"]]), sessions)).toMatchObject({ ok: true, answers: { sessions: [{ sessionId: "talk-a", usefulness: 4, comment: "" }] } });
  });
  it.each([
    [["sessionId", "unknown"]], [["sessionId", "talk-a"], ["sessionId", "talk-a"]],
    [["sessionId", "talk-a"], ["session:talk-a:comment", "a".repeat(2001)]],
    [["sessionId", "talk-a"], ["session:talk-a:usefulness", "6"]],
  ] as [string, string][][])("rejects invalid, duplicate or oversized session reviews", (...entries) => {
    expect(readFeedbackAnswers(data(entries), sessions).ok).toBe(false);
  });
  it("checks text limits and choice values at the outgoing form boundary", () => {
    expect(readFeedbackAnswers(data([["keep", "a".repeat(2001)], ["part:venue", "6"], ["more", "unknown"]]), sessions)).toMatchObject({ ok: false, errors: { keep: expect.any(String), "part:venue": expect.any(String), more: expect.any(String) } });
  });
  it("renders the actual deadline in Skopje time independent of the visitor's zone", () => {
    expect(formatFeedbackDeadline("2026-10-05T21:59:00Z")).toBe("5 October 2026 at 23:59 (Europe/Skopje)");
  });
});

import { describe, expect, it } from "vite-plus/test";
import { readFeedbackAnswers } from "./form-data";

const sessions = [{ id: "talk-a", title: "Talk A" }, { id: "talk-b", title: "Talk B" }];

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("feedback answer errors", () => {
  it("reports every invalid field with its exact message in reading order", () => {
    const result = readFeedbackAnswers(form([
      ["part:venue", "7"], ["part:content", "na"],
      ["more", "other"], ["more", "other"], ["moreOther", "a".repeat(501)],
      ["sessionId", "talk-b"], ["session:talk-b:usefulness", "0"], ["session:talk-b:comment", "b".repeat(2001)],
      ["sessionId", "talk-b"], ["sessionId", "unknown"],
      ["keep", "k".repeat(2001)], ["change", "c".repeat(2001)],
    ]), sessions);
    expect(result).toEqual({
      ok: false,
      errors: {
        overall: "Choose an overall rating before submitting.",
        "part:venue": "Choose a rating from 1 to 5, or N/A.",
        more: "Choose up to three options.",
        moreOther: "Please use 500 characters or fewer.",
        "session:talk-b:usefulness": "Choose a usefulness rating from 1 to 5.",
        "session:talk-b:comment": "Please use 2,000 characters or fewer.",
        sessions: "Choose each session once from the session list.",
        keep: "Please use 2,000 characters or fewer.",
        change: "Please use 2,000 characters or fewer.",
      },
    });
    expect(Object.keys(result.ok ? {} : result.errors)).toEqual([
      "overall", "part:venue", "more", "moreOther", "session:talk-b:usefulness", "session:talk-b:comment", "sessions", "keep", "change",
    ]);
  });

  it("returns trimmed answers with sessions in submitted order and parts in definition order", () => {
    expect(readFeedbackAnswers(form([
      ["overall", " 4 "], ["part:venue", "2"], ["part:content", "na"],
      ["more", "demos"], ["more", "other"], ["moreOther", "  More demos  "],
      ["sessionId", "talk-b"], ["session:talk-b:usefulness", "5"], ["session:talk-b:comment", " Great "],
      ["sessionId", "talk-a"], ["session:talk-a:comment", ""],
      ["keep", " The talks "], ["change", ""],
    ]), sessions)).toEqual({
      ok: true,
      answers: {
        overall: 4,
        parts: { content: "na", venue: 2 },
        keep: "The talks",
        change: "",
        more: ["demos", "other"],
        moreOther: "More demos",
        sessions: [{ sessionId: "talk-b", usefulness: 5, comment: "Great" }],
      },
    });
  });
});

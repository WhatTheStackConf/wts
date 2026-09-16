import { describe, expect, it } from "vite-plus/test";
import { evaluateMissionAnswers, parseQuestionnaire, publicQuestions } from "~/lib/mission-questions";
import { createMissionCodeGeneration } from "~/lib/mission-code-crypto";

const definition = { policy: "all_correct", questions: [
  { id: "language", kind: "text", prompt: "Name the language", acceptedAnswers: ["TypeScript"] },
  { id: "pick", kind: "single_choice", prompt: "Pick one", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], acceptedAnswers: ["b"] },
] };

describe("question qualification contract", () => {
  it("rejects bearer codes in question content instead of exposing them to attendees", () => {
    const rawCode = createMissionCodeGeneration("question-tests-only").rawCode;
    expect(() => parseQuestionnaire({ ...definition, questions: [{ ...definition.questions[0], prompt: rawCode }] })).toThrow("must not contain Mission codes");
    expect(() => parseQuestionnaire({ ...definition, questions: [{ ...definition.questions[0], acceptedAnswers: [rawCode.split("").join("\n")] }] })).toThrow("must not contain Mission codes");
  });
  it("requires the whole answer set, normalizes text, and projects no answer keys", () => {
    const parsed = parseQuestionnaire(definition);
    expect(evaluateMissionAnswers(parsed, { language: "  TYPESCRIPT ", pick: "b" })).toBe("passed");
    expect(evaluateMissionAnswers(parsed, { language: "TypeScript" })).toBe("incomplete");
    expect(evaluateMissionAnswers(parsed, { language: "JavaScript", pick: "b" })).toBe("incorrect");
    expect(evaluateMissionAnswers(parsed, { language: "TypeScript", pick: "b", injected: "yes" })).toBe("malformed");
    expect(JSON.stringify(publicQuestions(parsed))).not.toContain("acceptedAnswers");
    expect(JSON.stringify(publicQuestions(parsed))).not.toContain("TypeScript");
  });
});
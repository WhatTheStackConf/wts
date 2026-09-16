import { z } from "zod";
import { containsMissionCode } from "~/lib/mission-code-format";

const id = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const answer = z.string().trim().min(1).max(1000);
const common = { id, prompt: z.string().trim().min(1).max(500), acceptedAnswers: z.array(answer).max(8).default([]) };
const question = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("text") }),
  z.strictObject({ ...common, kind: z.literal("single_choice"), choices: z.array(z.strictObject({ id, label: z.string().trim().min(1).max(200) })).min(2).max(8) }),
]);
const schema = z.strictObject({ policy: z.enum(["all_answered", "all_correct"]), questions: z.array(question).min(1).max(10) }).superRefine((value, ctx) => {
  if (new Set(value.questions.map(q => q.id)).size !== value.questions.length) ctx.addIssue({ code: "custom", message: "Question IDs must be unique." });
  for (const q of value.questions) {
    if (value.policy === "all_correct" && !q.acceptedAnswers.length) ctx.addIssue({ code: "custom", message: "Every question needs an accepted answer." });
    if (q.kind === "single_choice" && (new Set(q.choices.map(c => c.id)).size !== q.choices.length || q.acceptedAnswers.some(a => !q.choices.some(c => c.id === a)))) ctx.addIssue({ code: "custom", message: "Choice IDs must be unique and accepted choices must exist." });
  }
});
export type QuestionnaireDefinition = z.infer<typeof schema>;
export type PublicMissionQuestion = { id: string; prompt: string; kind: "text" } | { id: string; prompt: string; kind: "single_choice"; choices: Array<{ id: string; label: string }> };
export interface MissionQuestionChallenge { challengeId: string; expiresAt: string; policy: QuestionnaireDefinition["policy"]; questions: PublicMissionQuestion[] }
export type MissionAnswerOutcome = "passed" | "incomplete" | "incorrect" | "malformed";
export function parseQuestionnaire(value: unknown): QuestionnaireDefinition {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Use 1–10 unique questions, prompts up to 500 characters, and 2–8 unique choices. All-correct questions need valid accepted answers (up to 1000 characters).");
  if (parsed.data.questions.some(question => [question.prompt, ...question.acceptedAnswers, ...(question.kind === "single_choice" ? question.choices.map(choice => choice.label) : [])].some(containsMissionCode))) throw new Error("Questions, choices and accepted answers must not contain Mission codes.");
  return parsed.data;
}
/** Deliberately reconstruct; never spread a private question. */
export function publicQuestions(value: QuestionnaireDefinition): PublicMissionQuestion[] {
  return value.questions.map(q => q.kind === "text" ? { id: q.id, prompt: q.prompt, kind: q.kind } : { id: q.id, prompt: q.prompt, kind: q.kind, choices: q.choices.map(c => ({ id: c.id, label: c.label })) });
}
/** Deterministic Unicode case-fold approximation (NFKC, lower, sharp-s/final-sigma). No AI judging. */
export function normalizeMissionAnswer(value: string): string { return value.normalize("NFKC").trim().toLowerCase().replaceAll("ß", "ss").replaceAll("ς", "σ"); }
export function validMissionAnswers(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length <= 10 && Object.entries(value).every(([k, v]) => /^[a-z][a-z0-9_-]{0,39}$/.test(k) && typeof v === "string" && v.length <= 1000));
}
export function evaluateMissionAnswers(definition: QuestionnaireDefinition, value: unknown): MissionAnswerOutcome {
  if (!validMissionAnswers(value) || Object.keys(value).some(key => !definition.questions.some(q => q.id === key))) return "malformed";
  if (definition.questions.some(q => !value[q.id]?.trim())) return "incomplete";
  if (definition.questions.some(q => q.kind === "single_choice" && !q.choices.some(c => c.id === value[q.id]))) return "malformed";
  return definition.policy === "all_answered" || definition.questions.every(q => q.acceptedAnswers.some(a => q.kind === "text" ? normalizeMissionAnswer(a) === normalizeMissionAnswer(value[q.id]) : a === value[q.id])) ? "passed" : "incorrect";
}

export function assertMissionUser(expectedUserId: unknown, authenticatedUserId: string): void {
  if (typeof expectedUserId !== "string" || !expectedUserId || expectedUserId !== authenticatedUserId) throw new Error("Your signed-in User changed. Reload before continuing.");
}

export function missionRetrySeconds(retryAt: number, now: number): number { return Math.max(0, Math.ceil((retryAt - now) / 1000)); }
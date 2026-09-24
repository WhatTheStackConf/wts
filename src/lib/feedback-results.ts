import { z } from "zod";
import { FEEDBACK_MORE_OPTIONS, FEEDBACK_PARTS } from "./feedback-contract";

export const MAIN_FEEDBACK_KEY = "wts-2026-main-day-feedback";
const rating = z.number().int().min(1).max(5);
const text = (max: number) => z.string().max(max);
export const resultsSurveySchema = z.object({
  title: text(300).min(1), version: text(80).min(1),
  sessions: z.array(z.strictObject({ id: text(100).regex(/^[A-Za-z0-9_-]{1,100}$/), title: text(300).refine(value => !!value.trim()) })).max(200),
}).refine(s => new Set(s.sessions.map(s => s.id)).size === s.sessions.length);
const answersSchema = z.strictObject({
  overall: rating,
  parts: z.strictObject({ content: rating.or(z.literal("na")).optional(), organisation: rating.or(z.literal("na")).optional(), venue: rating.or(z.literal("na")).optional(), connections: rating.or(z.literal("na")).optional() }),
  keep: text(2000), change: text(2000), moreOther: text(500),
  more: z.array(z.enum(["technical", "case_studies", "demos", "discussion", "beginner", "workshops", "meeting", "other"])).max(3),
  sessions: z.array(z.strictObject({ sessionId: text(100), usefulness: rating.optional(), comment: text(2000) })).max(200),
}).refine(a => new Set(a.more).size === a.more.length && (!a.moreOther || a.more.includes("other")));
export interface FeedbackScore { count: number; mean: number | null; distribution: number[] }
export interface FeedbackResults {
  title: string; responseCount: number; overall: FeedbackScore;
  parts: { label: string; score: FeedbackScore; notApplicable: number; skipped: number }[];
  more: { label: string; count: number }[];
  comments: { question: string; comments: string[] }[];
  sessions: { title: string; score: FeedbackScore | null; comments: string[] }[];
}
function score(values: number[]): FeedbackScore {
  return { count: values.length, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    distribution: [1, 2, 3, 4, 5].map(r => values.filter(v => v === r).length) };
}
/** Pure projection: never returns respondent bundles, persistence IDs or traversal metadata.
 * The server must independently shuffle every comment group before returning this DTO.
 */
export function aggregateFeedback(inputSurvey: unknown, inputAnswers: unknown[]): FeedbackResults {
  const survey = resultsSurveySchema.parse(inputSurvey);
  const answers = inputAnswers.map(a => answersSchema.parse(a));
  const ids = new Set(survey.sessions.map(s => s.id));
  for (const a of answers) {
    if (new Set(a.sessions.map(s => s.sessionId)).size !== a.sessions.length || a.sessions.some(s => !ids.has(s.sessionId) || (s.usefulness === undefined && !s.comment.trim()))) throw new Error("Invalid session feedback");
  }
  const comments = (values: string[]) => values.map(v => v.trim()).filter(Boolean);
  return {
    title: survey.title, responseCount: answers.length,
    overall: score(answers.map(a => a.overall)),
    parts: FEEDBACK_PARTS.map(p => ({ label: p.label, notApplicable: answers.filter(a => a.parts[p.id] === "na").length, skipped: answers.filter(a => a.parts[p.id] === undefined).length, score: score(answers.flatMap(a => typeof a.parts[p.id] === "number" ? [a.parts[p.id] as number] : [])) })),
    more: FEEDBACK_MORE_OPTIONS.map(o => ({ label: o.label, count: answers.filter(a => a.more.includes(o.id)).length })),
    comments: [
      { question: "What should we keep?", comments: comments(answers.map(a => a.keep)) },
      { question: "What should we change?", comments: comments(answers.map(a => a.change)) },
      { question: "Other ideas for next year", comments: comments(answers.map(a => a.moreOther)) },
    ],
    sessions: survey.sessions.map(s => {
      const entries = answers.flatMap(a => a.sessions.filter(e => e.sessionId === s.id));
      const ratings = entries.flatMap(e => e.usefulness === undefined ? [] : [e.usefulness]);
      return { title: s.title, score: ratings.length >= 5 ? score(ratings) : null, comments: comments(entries.map(e => e.comment)) };
    }),
  };
}

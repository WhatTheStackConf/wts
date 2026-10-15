import { FEEDBACK_MORE_OPTIONS, FEEDBACK_PARTS, type FeedbackAnswers, type FeedbackMore, type FeedbackRating, type FeedbackSurvey } from "~/lib/feedback-contract";

export type FeedbackErrors = Record<string, string>;
export type AnswerRead = { ok: true; answers: FeedbackAnswers } | { ok: false; errors: FeedbackErrors };

function rating(value: string): FeedbackRating | undefined {
  return /^[1-5]$/.test(value) ? Number(value) as FeedbackRating : undefined;
}

type AnswerReader = {
  errors: FeedbackErrors;
  text(key: string): string;
  bounded(key: string, max: number): string;
};

function answerReader(data: FormData): AnswerReader {
  const errors: FeedbackErrors = {};
  const text = (key: string) => String(data.get(key) ?? "").trim();
  return {
    errors,
    text,
    bounded(key, max) {
      const value = text(key);
      if (value.length > max) errors[key] = `Please use ${max.toLocaleString("en-GB")} characters or fewer.`;
      return value;
    },
  };
}

function readParts(read: AnswerReader): FeedbackAnswers["parts"] {
  const parts: FeedbackAnswers["parts"] = {};
  for (const part of FEEDBACK_PARTS) {
    const value = read.text(`part:${part.id}`);
    if (!value) continue;
    const score = value === "na" ? "na" : rating(value);
    if (score) parts[part.id] = score;
    else read.errors[`part:${part.id}`] = "Choose a rating from 1 to 5, or N/A.";
  }
  return parts;
}

function validMore(more: string[]): boolean {
  return more.length <= 3 && new Set(more).size === more.length && more.every(value => FEEDBACK_MORE_OPTIONS.some(option => option.id === value));
}

function readSessionReview(read: AnswerReader, sessionId: string): FeedbackAnswers["sessions"][number] | undefined {
  const scoreKey = `session:${sessionId}:usefulness`;
  const scoreText = read.text(scoreKey);
  const usefulness = rating(scoreText);
  if (scoreText && !usefulness) read.errors[scoreKey] = "Choose a usefulness rating from 1 to 5.";
  const comment = read.bounded(`session:${sessionId}:comment`, 2000);
  if (!usefulness && !comment) return undefined;
  return { sessionId, ...(usefulness ? { usefulness } : {}), comment };
}

function readSessionReviews(read: AnswerReader, data: FormData, sessions: FeedbackSurvey["sessions"]): FeedbackAnswers["sessions"] {
  const reviews: FeedbackAnswers["sessions"] = [];
  const seen = new Set<string>();
  for (const sessionId of data.getAll("sessionId").map(String)) {
    if (seen.has(sessionId) || !sessions.some(session => session.id === sessionId)) {
      read.errors.sessions = "Choose each session once from the session list.";
      continue;
    }
    seen.add(sessionId);
    const review = readSessionReview(read, sessionId);
    if (review) reviews.push(review);
  }
  return reviews;
}

export function readFeedbackAnswers(data: FormData, sessions: FeedbackSurvey["sessions"]): AnswerRead {
  const read = answerReader(data);
  const { errors } = read;
  const overall = rating(read.text("overall"));
  if (!overall) errors.overall = "Choose an overall rating before submitting.";
  const parts = readParts(read);
  const more = data.getAll("more").map(String);
  if (!validMore(more)) errors.more = "Choose up to three options.";
  const moreOther = more.includes("other") ? read.bounded("moreOther", 500) : "";
  const reviews = readSessionReviews(read, data, sessions);
  const keep = read.bounded("keep", 2000);
  const change = read.bounded("change", 2000);
  if (Object.keys(errors).length || !overall) return { ok: false, errors };
  return { ok: true, answers: { overall, parts, keep, change, more: more as FeedbackMore[], moreOther, sessions: reviews } };
}

export function formatFeedbackDeadline(closesAt: string): string {
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Skopje", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(closesAt))} (Europe/Skopje)`;
}

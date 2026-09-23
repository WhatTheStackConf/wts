import { FEEDBACK_MORE_OPTIONS, FEEDBACK_PARTS, type FeedbackAnswers, type FeedbackMore, type FeedbackRating, type FeedbackSurvey } from "~/lib/feedback-contract";

export type FeedbackErrors = Record<string, string>;
export type AnswerRead = { ok: true; answers: FeedbackAnswers } | { ok: false; errors: FeedbackErrors };

function rating(value: string): FeedbackRating | undefined {
  return /^[1-5]$/.test(value) ? Number(value) as FeedbackRating : undefined;
}

export function readFeedbackAnswers(data: FormData, sessions: FeedbackSurvey["sessions"]): AnswerRead {
  const errors: FeedbackErrors = {};
  const text = (key: string) => String(data.get(key) ?? "").trim();
  const bounded = (key: string, max: number) => {
    const value = text(key);
    if (value.length > max) errors[key] = `Please use ${max.toLocaleString("en-GB")} characters or fewer.`;
    return value;
  };
  const overall = rating(text("overall"));
  if (!overall) errors.overall = "Choose an overall rating before submitting.";
  const parts: FeedbackAnswers["parts"] = {};
  for (const part of FEEDBACK_PARTS) {
    const value = text(`part:${part.id}`);
    if (value === "na") parts[part.id] = "na";
    else if (value) {
      const score = rating(value);
      if (score) parts[part.id] = score;
      else errors[`part:${part.id}`] = "Choose a rating from 1 to 5, or N/A.";
    }
  }
  const more = data.getAll("more").map(String);
  if (more.length > 3 || new Set(more).size !== more.length || more.some(value => !FEEDBACK_MORE_OPTIONS.some(option => option.id === value))) errors.more = "Choose up to three options.";
  const moreOther = more.includes("other") ? bounded("moreOther", 500) : "";
  const reviews: FeedbackAnswers["sessions"] = [];
  const seen = new Set<string>();
  for (const sessionId of data.getAll("sessionId").map(String)) {
    if (seen.has(sessionId) || !sessions.some(session => session.id === sessionId)) {
      errors.sessions = "Choose each session once from the session list.";
      continue;
    }
    seen.add(sessionId);
    const scoreKey = `session:${sessionId}:usefulness`;
    const scoreText = text(scoreKey);
    const usefulness = rating(scoreText);
    if (scoreText && !usefulness) errors[scoreKey] = "Choose a usefulness rating from 1 to 5.";
    const comment = bounded(`session:${sessionId}:comment`, 2000);
    if (usefulness || comment) reviews.push({ sessionId, ...(usefulness ? { usefulness } : {}), comment });
  }
  const keep = bounded("keep", 2000);
  const change = bounded("change", 2000);
  if (Object.keys(errors).length || !overall) return { ok: false, errors };
  return { ok: true, answers: { overall, parts, keep, change, more: more as FeedbackMore[], moreOther, sessions: reviews } };
}

export function formatFeedbackDeadline(closesAt: string): string {
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Skopje", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(closesAt))} (Europe/Skopje)`;
}

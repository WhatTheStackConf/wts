/** Shared public DTOs only. Invitation identities and response records never cross this boundary. */
export const FEEDBACK_MORE_OPTIONS = [
  { id: "technical", label: "Deep technical talks" },
  { id: "case_studies", label: "Practical case studies" },
  { id: "demos", label: "Live demos" },
  { id: "discussion", label: "Discussion and Q&A" },
  { id: "beginner", label: "Beginner-friendly content" },
  { id: "workshops", label: "Workshops" },
  { id: "meeting", label: "Time to meet people" },
  { id: "other", label: "Other" },
] as const;
export const FEEDBACK_PARTS = [
  { id: "content", label: "Talk selection and relevance" },
  { id: "organisation", label: "Organisation and communication" },
  { id: "venue", label: "Venue and finding your way around" },
  { id: "connections", label: "Opportunities to meet and talk with people" },
] as const;
export type FeedbackRating = 1 | 2 | 3 | 4 | 5;
export type FeedbackPart = (typeof FEEDBACK_PARTS)[number]["id"];
export type FeedbackMore = (typeof FEEDBACK_MORE_OPTIONS)[number]["id"];
export interface FeedbackAnswers {
  overall: FeedbackRating;
  parts: Partial<Record<FeedbackPart, FeedbackRating | "na">>;
  keep: string;
  change: string;
  more: FeedbackMore[];
  moreOther: string;
  sessions: { sessionId: string; usefulness?: FeedbackRating; comment: string }[];
}
export interface FeedbackSurvey {
  title: string;
  version: string;
  closesAt: string;
  sessions: { id: string; title: string }[];
}
export type FeedbackState = "invalid" | "used" | "expired" | "closed" | "unavailable" | "invalid_answers" | "submitted";
export type FeedbackResult = { state: "ready"; survey: FeedbackSurvey } | { state: FeedbackState };
export type FeedbackCommand = { action: "inspect"; token: string } | { action: "submit"; token: string; version: string; answers: FeedbackAnswers };
export const FEEDBACK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

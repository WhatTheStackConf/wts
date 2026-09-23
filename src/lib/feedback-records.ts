import type { FeedbackAnswers, FeedbackSurvey } from "./feedback-contract";

/** Private persistence types. Never send these records to the feedback page.
 * Deliberately do not extend a base type carrying created/updated timestamps.
 */
export interface FeedbackSurveyRecord {
  id: string;
  key: string;
  title: string;
  version: string;
  open: boolean;
  opens_at: string;
  closes_at: string;
  sessions: FeedbackSurvey["sessions"];
}
export interface FeedbackInvitationRecord {
  id: string;
  survey: string;
  source_key: string;
  email: string;
  token_hash: string;
  used: boolean;
  revoked: boolean;
  expires_at: string;
}
export interface FeedbackResponseRecord {
  id: string;
  survey: string;
  version: string;
  answers: FeedbackAnswers;
}

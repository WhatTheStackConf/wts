import type { QuestionnaireDefinition } from "~/lib/mission-questions";

export const QUESTION_COLLECTIONS = { definitions: "gamification_questionnaires", attempts: "gamification_question_attempts" } as const;
export interface MissionQuestionnaireRecord {
  id: string;
  activity: string;
  version: string;
  definition: QuestionnaireDefinition;
  operation_id: string;
  input_hash: string;
  updated_by: string;
  reason: string;
}
export interface MissionQuestionAttemptRecord {
  id: string;
  challenge_id: string;
  user: string;
  code: string;
  activity: string;
  questionnaire: string;
  version: string;
  expires_at: string;
  opened_at: string;
  status: "pending" | "passed" | "passed_half" | "incorrect" | "incomplete" | "malformed";
  operation_id: string;
  answer_hash: string;
  passed_at: string;
}
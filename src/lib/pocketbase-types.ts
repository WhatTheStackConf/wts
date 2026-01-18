import { RecordModel } from "pocketbase";

// User collection type
export interface UserRecord extends RecordModel {
  id: string;
  email: string;
  emailVisibility: boolean;
  username: string;
  name: string;
  avatar: string;
  created: string;
  updated: string;
  role: "user" | "reviewer" | "admin";
  verified?: boolean;
}

// CFP Applicant collection type
export interface CfpApplicantRecord extends RecordModel {
  id: string;
  affiliation: string;
  bio: string;
  social_handles?: any; // JSON field
  preferred_contact_method: string;
  user: string; // relation to users collection
  created: string;
  updated: string;
}

// CFP Submission collection type
export interface CfpSubmissionRecord extends RecordModel {
  id: string;
  session_title: string;
  abstract: string;
  key_takeaways: string;
  technical_requirements?: string;
  notes?: string;
  applicant: string; // relation to cfp_applicants collection
  created: string;
  updated: string;
  status?: "pending" | "accepted" | "rejected";
}

// CFP Review collection type
export interface CfpReviewRecord extends RecordModel {
  id: string;
  submission: string; // relation to cfp_submissions
  reviewer: string;   // relation to users
  score_relevance: number;   // 1-5
  score_originality: number; // 1-5
  score_depth: number;       // 1-5
  score_clarity: number;     // 1-5
  score_takeaways: number;   // 1-5
  score_engagement: number;  // 1-5
  notes?: string;
  is_llm_suspected: boolean;
  created: string;
  updated: string;
}

// Type for authentication data
export interface AuthData {
  record: UserRecord;
  token: string;
}

// Union type for all possible collections
export type CollectionRecord =
  | UserRecord
  | CfpApplicantRecord
  | CfpSubmissionRecord
  | CfpReviewRecord;

// Type guard functions
export function isUserRecord(record: CollectionRecord): record is UserRecord {
  return (
    (record as any).collectionId === "users" ||
    (record as any).collectionName === "users"
  );
}

export function isCfpApplicantRecord(
  record: CollectionRecord,
): record is CfpApplicantRecord {
  return (record as any).collectionName === "cfp_applicants";
}

export function isCfpSubmissionRecord(
  record: CollectionRecord,
): record is CfpSubmissionRecord {
  return (record as any).collectionName === "cfp_submissions";
}

export function isCfpReviewRecord(
  record: CollectionRecord,
): record is CfpReviewRecord {
  return (record as any).collectionName === "cfp_reviews";
}

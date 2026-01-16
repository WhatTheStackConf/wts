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
  role?: string;
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
  | CfpSubmissionRecord;

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

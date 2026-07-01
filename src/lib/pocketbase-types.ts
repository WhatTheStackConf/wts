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
  meta?: any; // JSON field containing expenses, notes, etc.
}

// Speaker collection type (public conference persona)
export interface SpeakerRecord extends RecordModel {
  id: string;
  slug: string;
  published: boolean;
  origin: "cfp" | "invite";
  display_name?: string;
  user?: string;
  cfp_applicant?: string;
  photo?: string;
  affiliation?: string;
  bio?: string;
  social_handles?: unknown;
  /** Optional promo page overrides: statusMessage, roleLine, stack[], ctaHref, ctaLabel, footerText, footerLinks[] */
  promo?: unknown;
  created: string;
  updated: string;
}

// Session collection type (public programme item)
export interface SessionRecord extends RecordModel {
  id: string;
  slug: string;
  published: boolean;
  title: string;
  abstract: string;
  format?: string;
  starts_at?: string;
  track?: string;
  room?: string;
  speakers?: string[];
  created: string;
  updated: string;
}

// Partner/sponsor collection type (public conference organizations)
export interface PartnerRecord extends RecordModel {
  id: string;
  name: string;
  published: boolean;
  type:
    | "organizer"
    | "sponsor"
    | "supporter"
    | "media"
    | "catering"
    | "other"
    | "company_supporter";
  tier?: "platinum" | "gold" | "silver" | "bronze";
  logo: string;
  url?: string;
  description?: string;
  created: string;
  updated: string;
}

// MCP token collection type (admin-created remote MCP access tokens)
export interface McpTokenRecord extends RecordModel {
  id: string;
  name: string;
  token_id: string;
  token_prefix: string;
  secret_hash: string;
  scopes?: string[];
  created_by: string;
  expires_at?: string;
  revoked_at?: string;
  revoked_by?: string;
  last_used_at?: string;
  created: string;
  updated: string;
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
  | CfpReviewRecord
  | SpeakerRecord
  | SessionRecord
  | PartnerRecord
  | McpTokenRecord;

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

export function isSpeakerRecord(
  record: CollectionRecord,
): record is SpeakerRecord {
  return (record as any).collectionName === "speakers";
}

export function isSessionRecord(
  record: CollectionRecord,
): record is SessionRecord {
  return (record as any).collectionName === "sessions";
}

export function isPartnerRecord(
  record: CollectionRecord,
): record is PartnerRecord {
  return (record as any).collectionName === "partners";
}

export function isMcpTokenRecord(
  record: CollectionRecord,
): record is McpTokenRecord {
  return (record as any).collectionName === "mcp_tokens";
}

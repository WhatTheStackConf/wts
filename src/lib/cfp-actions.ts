import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { requireAuth } from "~/lib/server-auth";
import { cfpDeadlineTimestamp } from "~/lib/cfp-deadline";

export interface MyCfpApplicantDto {
  id: string;
  user: string;
  affiliation: string;
  bio: string;
  social_handles: string[];
  preferred_contact_method: string;
  previous_talks: string;
}

export interface MyCfpSubmissionDto {
  id: string;
  applicant: string;
  session_title: string;
  abstract: string;
  key_takeaways: string;
  technical_requirements: string;
  notes: string;
  meta: Record<string, unknown>;
  status: "pending" | "accepted" | "rejected";
  created: string;
  updated: string;
  expand?: { applicant?: MyCfpApplicantDto };
}

export interface MyCfpApplicantInput {
  affiliation: string;
  bio: string;
  social_handles: string[];
  preferred_contact_method: string;
  previous_talks?: string;
}

export interface MyCfpSubmissionInput {
  id?: string;
  session_title: string;
  abstract: string;
  key_takeaways: string;
  technical_requirements: string;
  previous_talks?: string;
  meta: Record<string, unknown>;
}

const VALID_ID = /^[a-zA-Z0-9]{15}$/;

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new Error("Invalid CFP data.");
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error("Invalid CFP data.");
  return normalized;
}

function applicantDto(record: any): MyCfpApplicantDto {
  return {
    id: String(record.id),
    user: String(record.user),
    affiliation: String(record.affiliation || ""),
    bio: String(record.bio || ""),
    social_handles: Array.isArray(record.social_handles)
      ? record.social_handles.filter((value: unknown): value is string => typeof value === "string")
      : [],
    preferred_contact_method: String(record.preferred_contact_method || ""),
    previous_talks: String(record.previous_talks || ""),
  };
}

function submissionDto(record: any, applicant?: MyCfpApplicantDto): MyCfpSubmissionDto {
  const status = record.status;
  return {
    id: String(record.id),
    applicant: String(record.applicant),
    session_title: String(record.session_title || ""),
    abstract: String(record.abstract || ""),
    key_takeaways: String(record.key_takeaways || ""),
    technical_requirements: String(record.technical_requirements || ""),
    notes: String(record.notes || ""),
    meta: record.meta && typeof record.meta === "object" ? record.meta : {},
    status:
      status === "accepted" || status === "rejected" ? status : "pending",
    created: String(record.created || ""),
    updated: String(record.updated || ""),
    ...(applicant ? { expand: { applicant } } : {}),
  };
}

async function applicantForUser(userId: string): Promise<any | null> {
  const records = await getAdminPB().fetchAllRecords("cfp_applicants", {
    filter: `user = "${userId}"`,
    fields: "id,user,affiliation,bio,social_handles,preferred_contact_method,previous_talks",
  });
  return records[0] || null;
}

async function requireOpenCfp(): Promise<void> {
  const records = await getAdminPB().fetchAllRecords("conference_config", {
    fields: "cfp_open,cfp_deadline",
  });
  const config = records[0] as { cfp_open?: boolean; cfp_deadline?: string } | undefined;
  if (config?.cfp_open === false) throw new Error("The CFP is closed.");
  if (config && !config.cfp_deadline) return;
  const closesAt = cfpDeadlineTimestamp(config?.cfp_deadline);
  if (!Number.isFinite(closesAt) || Date.now() >= closesAt) {
    throw new Error("The CFP is closed.");
  }
}

export const fetchMyCfpApplicant = async (): Promise<MyCfpApplicantDto | null> => {
  "use server";
  const user = await requireAuth();
  const applicant = await applicantForUser(user.id);
  return applicant ? applicantDto(applicant) : null;
};

export const saveMyCfpApplicant = async (
  input: MyCfpApplicantInput,
): Promise<MyCfpApplicantDto> => {
  "use server";
  const user = await requireAuth();
  const socialHandles = input.social_handles
    .map((value) => text(value, 300))
    .filter(Boolean)
    .slice(0, 20);
  const data = {
    affiliation: text(input.affiliation, 300),
    bio: text(input.bio, 10_000),
    social_handles: socialHandles,
    preferred_contact_method: text(input.preferred_contact_method, 300),
    previous_talks: text(input.previous_talks || "", 10_000),
    user: user.id,
  };
  const existing = await applicantForUser(user.id);
  const saved = existing
    ? await getAdminPB().updateRecord("cfp_applicants", existing.id, data)
    : await getAdminPB().createRecord("cfp_applicants", data);
  return applicantDto(saved);
};

export const fetchMyCfpSubmissions = async (): Promise<MyCfpSubmissionDto[]> => {
  "use server";
  const user = await requireAuth();
  const applicant = await applicantForUser(user.id);
  if (!applicant) return [];
  const records = await getAdminPB().fetchAllRecords("cfp_submissions", {
    filter: `applicant = "${applicant.id}"`,
    sort: "-created",
  });
  const ownApplicant = applicantDto(applicant);
  return records.map((record: any) => submissionDto(record, ownApplicant));
};

export const saveMyCfpSubmissionCore = async (
  input: MyCfpSubmissionInput,
): Promise<MyCfpSubmissionDto> => {
  const user = await requireAuth();
  await requireOpenCfp();
  const applicant = await applicantForUser(user.id);
  if (!applicant) throw new Error("Complete your CFP profile first.");

  if (input.previous_talks !== undefined) {
    await getAdminPB().updateRecord("cfp_applicants", applicant.id, {
      previous_talks: text(input.previous_talks, 10_000),
      user: user.id,
    });
  }

  const data = {
    session_title: text(input.session_title, 500),
    abstract: text(input.abstract, 50_000),
    key_takeaways: text(input.key_takeaways, 50_000),
    technical_requirements: text(input.technical_requirements, 10_000),
    meta: input.meta && typeof input.meta === "object" ? input.meta : {},
    applicant: applicant.id,
  };

  let saved;
  if (input.id) {
    if (!VALID_ID.test(input.id)) throw new Error("Invalid CFP submission.");
    const existing = await getAdminPB().fetchRecordById("cfp_submissions", input.id);
    if (existing.applicant !== applicant.id) throw new Error("Unauthorized");
    if (existing.status && existing.status !== "pending") {
      throw new Error("Finalized CFP submissions cannot be edited.");
    }
    saved = await getAdminPB().updateRecord("cfp_submissions", input.id, data);
  } else {
    saved = await getAdminPB().createRecord("cfp_submissions", data);
  }
  return submissionDto(saved, applicantDto(applicant));
};

export const saveMyCfpSubmission = async (
  input: MyCfpSubmissionInput,
): Promise<MyCfpSubmissionDto> => {
  "use server";
  return saveMyCfpSubmissionCore(input);
};

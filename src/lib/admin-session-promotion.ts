import { slugify } from "~/lib/conference-slug";
import {
  createOrReuseCfpSpeakerFromApplicant,
  isDuplicateFieldError,
  speakerSnapshot,
} from "~/lib/admin-speaker-profile";
import type { AdminSpeakerService } from "~/lib/admin-speaker-profile";
import type {
  CfpApplicantRecord,
  CfpSubmissionRecord,
  SessionRecord,
  UserRecord,
} from "~/lib/pocketbase-types";

export type SessionEditableInput = {
  slug?: string;
  title?: string;
  abstract?: string;
  format?: string;
  speakers?: string[];
  cfp_submission?: never;
};

export type PromotedSessionSummary = {
  id: string;
  slug: string;
  title: string;
  published: boolean;
  editHref: string;
};

export type PromoteSubmissionResult = {
  session: PromotedSessionSummary;
  speaker: ReturnType<typeof speakerSnapshot>;
  speakerCreated: boolean;
};

type ExpandedCfpSubmissionRecord = CfpSubmissionRecord & {
  expand?: {
    applicant?: CfpApplicantRecord & { expand?: { user?: UserRecord } };
  };
};

function quotePbString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function sessionSummary(record: SessionRecord): PromotedSessionSummary {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    published: Boolean(record.published),
    editHref: `/admin/sessions?edit=${encodeURIComponent(record.id)}`,
  };
}

export function addPromotedSessionSummaries<T extends { id: string }>(
  submissions: T[],
  sessions: SessionRecord[],
): Array<T & { promotedSession: PromotedSessionSummary | null }> {
  const promotedBySubmission = new Map<string, PromotedSessionSummary>();

  for (const session of sessions) {
    if (!session.cfp_submission || promotedBySubmission.has(session.cfp_submission)) continue;
    promotedBySubmission.set(session.cfp_submission, sessionSummary(session));
  }

  return submissions.map((submission) => ({
    ...submission,
    promotedSession: promotedBySubmission.get(submission.id) || null,
  }));
}

export function buildSessionCreateBody(input: SessionEditableInput): Record<string, unknown> {
  return {
    slug: slugify(input.slug || input.title || ""),
    title: input.title || "",
    abstract: input.abstract || "",
    format: input.format || "",
    speakers: Array.isArray(input.speakers) ? input.speakers : [],
    published: false,
  };
}

export function buildSessionUpdateBody(input: SessionEditableInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if ("slug" in input || "title" in input) {
    body.slug = slugify(input.slug || input.title || "");
  }
  if ("title" in input) body.title = input.title || "";
  if ("abstract" in input) body.abstract = input.abstract || "";
  if ("format" in input) body.format = input.format || "";
  if ("speakers" in input) body.speakers = Array.isArray(input.speakers) ? input.speakers : [];
  return body;
}

export async function setSessionPublished(
  adminService: AdminSpeakerService,
  id: string,
  published: boolean,
): Promise<SessionRecord> {
  return (await adminService.updateRecord("sessions", id, {
    published: Boolean(published),
  })) as SessionRecord;
}

async function fetchPromotedSessionForSubmission(
  adminService: AdminSpeakerService,
  submissionId: string,
): Promise<PromotedSessionSummary | null> {
  const sessions = (await adminService.fetchAllRecords("sessions", {
    filter: `cfp_submission = "${quotePbString(submissionId)}"`,
    fields: "id,slug,title,published,cfp_submission",
  })) as SessionRecord[];

  return sessions[0] ? sessionSummary(sessions[0]) : null;
}

async function sessionSlugExists(
  adminService: AdminSpeakerService,
  slug: string,
): Promise<boolean> {
  const hits = await adminService.fetchAllRecords("sessions", {
    filter: `slug = "${quotePbString(slug)}"`,
    fields: "id",
  });
  return hits.length > 0;
}

async function uniqueSessionSlug(
  adminService: AdminSpeakerService,
  title: string,
): Promise<string> {
  const base = slugify(title) || "session";
  if (!(await sessionSlugExists(adminService, base))) return base;

  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!(await sessionSlugExists(adminService, candidate))) return candidate;
  }

  return `${base}-${Date.now()}`;
}

function duplicatePromotionError(promotedSession: PromotedSessionSummary | null): Error {
  const visibility = promotedSession?.published ? "published" : "draft";
  return new Error(`This proposal already has a ${visibility} Session.`);
}

export async function promoteSubmissionToDraftSession(
  adminService: AdminSpeakerService,
  submissionId: string,
): Promise<PromoteSubmissionResult> {
  const safeSubmissionId = submissionId?.trim();
  if (!safeSubmissionId) throw new Error("Choose a proposal to promote.");

  const submission = (await adminService.fetchRecordById(
    "cfp_submissions",
    safeSubmissionId,
    { expand: "applicant.user" },
  )) as ExpandedCfpSubmissionRecord;

  if (submission.status !== "accepted") {
    throw new Error("This proposal is no longer accepted.");
  }

  const applicantId = typeof submission.applicant === "string" ? submission.applicant.trim() : "";
  if (!applicantId) {
    throw new Error("This proposal is missing a linked CFP Applicant.");
  }

  const existingPromotion = await fetchPromotedSessionForSubmission(
    adminService,
    safeSubmissionId,
  );
  if (existingPromotion) throw duplicatePromotionError(existingPromotion);

  const speakerResult = await createOrReuseCfpSpeakerFromApplicant(adminService, applicantId);
  const title = submission.session_title || "";
  const abstract = submission.abstract || "";
  const slug = await uniqueSessionSlug(adminService, title);
  const body = {
    ...buildSessionCreateBody({
      slug,
      title,
      abstract,
      format: "",
      speakers: [speakerResult.speaker.id],
    }),
    cfp_submission: safeSubmissionId,
  };

  try {
    const session = (await adminService.createRecord("sessions", body)) as SessionRecord;
    return {
      session: sessionSummary(session),
      speaker: speakerSnapshot(speakerResult.speaker),
      speakerCreated: speakerResult.created,
    };
  } catch (error) {
    if (isDuplicateFieldError(error, "cfp_submission")) {
      const promotedSession = await fetchPromotedSessionForSubmission(
        adminService,
        safeSubmissionId,
      );
      throw duplicatePromotionError(promotedSession);
    }
    throw error;
  }
}

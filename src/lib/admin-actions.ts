// API endpoint for admin operations
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { requireAdmin } from "~/lib/admin-security";
import { fetchHiEventsAttendees } from "~/lib/hievents";
import { slugify, uniqueSpeakerSlug } from "~/lib/conference-slug";
import {
  buildSpeakerCreateBody,
  buildSpeakerProfileUpdateBody,
  createOrReuseCfpSpeakerFromApplicant,
  isDuplicateFieldError,
  normalizeSpeakerProfileUpdateInput,
  normalizeSpeakerSocialHandles,
  speakerSnapshot,
  speakerSlugExistsForOther,
  validateSpeakerPhotoUpload,
} from "~/lib/admin-speaker-profile";
import {
  addPromotedSessionSummaries,
  buildSessionCreateBody,
  buildSessionUpdateBody,
  promoteSubmissionToDraftSession,
} from "~/lib/admin-session-promotion";
import type {
  SpeakerPhotoPayload,
  SpeakerProfileUpdateInput,
} from "~/lib/admin-speaker-profile";
import type { SessionEditableInput } from "~/lib/admin-session-promotion";
import type { PartnerRecord, SpeakerRecord } from "~/lib/pocketbase-types";

const PARTNER_LOGO_MAX_BYTES = 5 * 1024 * 1024;
const PARTNER_LOGO_TYPES = [
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
];
const PARTNER_TYPES = [
  "organizer",
  "sponsor",
  "supporter",
  "media",
  "catering",
  "other",
  "company_supporter",
] as const;
const PARTNER_TIERS = ["platinum", "gold", "silver", "bronze"] as const;

/** Backwards-compatible alias for the existing invite speaker UI. */
export type InviteSpeakerPhotoPayload = SpeakerPhotoPayload;
export type { SpeakerPhotoPayload, SpeakerProfileUpdateInput };

function pbAdminErrorMessage(error: unknown): string {
  const response = (error as { response?: { data?: Record<string, { message?: string }> } })
    ?.response;
  const data = response?.data;
  if (data && typeof data === "object") {
    const parts = Object.entries(data)
      .map(([field, detail]) => {
        const message =
          detail && typeof detail === "object" && "message" in detail
            ? String(detail.message)
            : JSON.stringify(detail);
        return `${field}: ${message}`;
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("; ");
  }
  if (error instanceof Error && error.message) return error.message;
  return "Request failed";
}

/** Serializable file payload for partner logos (Seroval-safe). */
export type PartnerLogoPayload = {
  name: string;
  type: string;
  data: number[];
};

export type PartnerInput = {
  name: string;
  type: PartnerRecord["type"];
  tier?: PartnerRecord["tier"] | "";
  url?: string;
  description?: string;
  published?: boolean;
  logo?: PartnerLogoPayload | null;
};

function partnerSnapshot(record: PartnerRecord) {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    tier: record.tier,
    published: record.published,
    logo: record.logo,
    url: record.url,
  };
}

function validatePartnerInput(input: PartnerInput, requireLogo: boolean) {
  const name = input.name?.trim();
  if (!name) return "Partner name is required.";
  if (!PARTNER_TYPES.includes(input.type)) return "Choose a valid partner type.";
  if (input.tier && !PARTNER_TIERS.includes(input.tier)) {
    return "Choose a valid sponsor tier.";
  }
  if (requireLogo && !input.logo?.data?.length) return "Logo is required.";
  if (input.logo?.data?.length) {
    if (input.logo.data.length > PARTNER_LOGO_MAX_BYTES) {
      return "Logo must be 5 MB or smaller.";
    }
    if (input.logo.type && !PARTNER_LOGO_TYPES.includes(input.logo.type)) {
      return "Logo must be SVG, PNG, JPEG, WebP, or AVIF.";
    }
  }
  return null;
}

function normalizedPartnerFields(input: PartnerInput) {
  return {
    name: input.name.trim(),
    published: input.published ?? false,
    type: input.type,
    tier: input.type === "sponsor" ? input.tier || "" : "",
    url: input.url?.trim() || "",
    description: input.description?.trim() || "",
  };
}

function buildPartnerBody(
  fields: ReturnType<typeof normalizedPartnerFields>,
  logo?: PartnerLogoPayload | null,
): Record<string, unknown> | FormData {
  if (!logo?.data?.length) return fields;

  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, String(value));
  }
  const blob = new Blob([new Uint8Array(logo.data)], {
    type: logo.type || "application/octet-stream",
  });
  body.append("logo", blob, logo.name || "logo");
  return body;
}

// Define a server function for admin operations
export const adminCreateEvent = async (eventData: any) => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.createRecord("events", eventData);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin create event error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminUpdateEvent = async (id: string, eventData: any) => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.updateRecord("events", id, eventData);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin update event error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminDeleteEvent = async (id: string) => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.deleteRecord("events", id);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin delete event error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminFetchAllEvents = async () => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.fetchAllRecords("events");
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin fetch all events error:", error);
    return { success: false, error: (error as Error).message };
  }
};

// User Management Actions
export const adminFetchAllUsers = async () => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();

    // Fetch users, applicants, and attendees in parallel
    let attendees: any[] = [];
    const [users, applicants] = await Promise.all([
      adminService.fetchAllRecords("users", { sort: "-created" }),
      adminService.fetchAllRecords("cfp_applicants", { fields: "user" }),
      fetchHiEventsAttendees().then(a => { attendees = a; }).catch(() => {}),
    ]);

    // Create lookup sets
    const applicantUserIds = new Set(applicants.map((a: any) => a.user));
    const attendeeEmails = new Set(attendees.map((a: any) => a.email.toLowerCase()));

    // Enhance user objects with isApplicant and hasTicket flags
    const enhancedUsers = users.map((user: any) => ({
      ...user,
      isApplicant: applicantUserIds.has(user.id),
      hasTicket: attendeeEmails.has(user.email.toLowerCase()),
    }));

    return { success: true, data: enhancedUsers };
  } catch (error) {
    console.error("Admin fetch all users error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminUpdateUser = async (id: string, userData: any) => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.updateRecord("users", id, userData);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin update user error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminDeleteUser = async (id: string) => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.deleteRecord("users", id);
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin delete user error:", error);
    return { success: false, error: (error as Error).message };
  }
};

// Leaderboard Action
export const adminFetchLeaderboardData = async () => {
  "use server";

  try {
    await requireAdmin();
    const adminService = getAdminPB();

    // 1. Fetch EVERYTHING (using admin service)
    const [subs, reviews, votes, promotedSessions] = await Promise.all([
      adminService.fetchAllRecords("cfp_submissions", { expand: "applicant.user", sort: "-created" }),
      adminService.fetchAllRecords("cfp_reviews"),
      adminService.fetchAllRecords("cfp_weight_votes"),
      adminService.fetchAllRecords("sessions", {
        fields: "id,slug,title,published,cfp_submission",
        filter: "cfp_submission != ''",
      }),
    ]);

    // 2. Calculate Global Weights
    const CRITERIA = [
      { id: "relevance", label: "Relevance" },
      { id: "originality", label: "Originality" },
      { id: "depth", label: "Depth" },
      { id: "clarity", label: "Clarity" },
      { id: "takeaways", label: "Takeaways" },
      { id: "engagement", label: "Engagement" },
    ];

    const weights: Record<string, number> = {};
    CRITERIA.forEach(c => {
      const values = votes
        .map((v: any) => Number(v[c.id]))
        .filter((value) => Number.isFinite(value) && value > 0);
      const sum = values.reduce((acc, value) => acc + value, 0);
      weights[c.id] = values.length > 0 ? sum / values.length : 1;
    });

    // 3. Process Submissions
    const submissionsWithPromotion = addPromotedSessionSummaries(subs as any[], promotedSessions as any[]);

    const scoredSubmissions = submissionsWithPromotion.map(sub => {
      const subReviews = reviews.filter((r: any) => r.submission === sub.id);

      if (subReviews.length === 0) {
        return { ...sub, totalScore: 0, reviewCount: 0 };
      }

      // Calculate score for each review based on weights
      const reviewScores = subReviews.map((r: any) => {
        let rScore = 0;
        CRITERIA.forEach(c => {
          const criteriaScore = r[`score_${c.id}`] || 0;
          rScore += criteriaScore * (weights[c.id] || 1);
        });
        return rScore;
      });

      // Aggregate weighted scores across the committee; do not normalize by review count.
      const totalScore = reviewScores.reduce((a, b) => a + b, 0);

      return {
        ...sub,
        totalScore: totalScore,
        reviewCount: subReviews.length
      };
    });

    // 4. Sort by Score Descending
    scoredSubmissions.sort((a, b) => b.totalScore - a.totalScore);

    return { success: true, data: scoredSubmissions };

  } catch (error) {
    console.error("Admin fetch leaderboard error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminFetchUserSpeakerProfile = async (userId: string) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();

    // Find applicant profile for this user
    const applicants = await adminService.fetchAllRecords("cfp_applicants", {
      filter: `user = "${userId}"`,
    });

    if (applicants.length === 0) {
      return { success: true, data: null };
    }

    const applicant = applicants[0];

    // Fetch submissions for this applicant
    const submissions = await adminService.fetchAllRecords("cfp_submissions", {
      filter: `applicant = "${applicant.id}"`,
      sort: "-created",
    });

    return {
      success: true,
      data: {
        applicant,
        submissions,
      },
    };
  } catch (error) {
    console.error("Admin fetch user speaker profile error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminFetchAttendeesWithAccounts = async () => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();

    // Fetch attendees and users in parallel
    const [attendees, users] = await Promise.all([
      fetchHiEventsAttendees(),
      adminService.fetchAllRecords("users", { fields: "id,email,name" }),
    ]);

    // Build email -> user lookup
    const usersByEmail = new Map<string, { id: string; name: string }>();
    for (const u of users) {
      usersByEmail.set((u as any).email.toLowerCase(), { id: u.id, name: (u as any).name });
    }

    // Enrich attendees
    const enriched = attendees.map((a: any) => ({
      ...a,
      account: usersByEmail.get(a.email.toLowerCase()) || null,
    }));

    return { success: true, data: enriched };
  } catch (error) {
    console.error("Admin fetch attendees with accounts error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const deleteSubmission = async (id: string) => {
  "use server";
  try {
    await requireAdmin();
    const adminPB = getAdminPB();
    await adminPB.deleteRecord("cfp_submissions", id);
    return { success: true };
  } catch (error: any) {
    console.error("Delete submission error:", error);
    return { success: false, error: error.message };
  }
};

const CFP_SUBMISSION_STATUSES = ["pending", "accepted", "rejected"] as const;

export type CfpSubmissionStatus = (typeof CFP_SUBMISSION_STATUSES)[number];

function isCfpSubmissionStatus(status: unknown): status is CfpSubmissionStatus {
  return typeof status === "string" && CFP_SUBMISSION_STATUSES.includes(status as CfpSubmissionStatus);
}

export const adminSetSubmissionStatus = async (id: string, status: CfpSubmissionStatus) => {
  "use server";
  try {
    await requireAdmin();
    if (!isCfpSubmissionStatus(status)) return { success: false, error: "Choose a valid status." };
    const adminService = getAdminPB();
    const result = await adminService.updateRecord("cfp_submissions", id, { status });
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin set submission status error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export const adminSetSubmissionStatuses = async (ids: string[], status: CfpSubmissionStatus) => {
  "use server";
  try {
    await requireAdmin();
    if (!isCfpSubmissionStatus(status)) return { success: false, error: "Choose a valid status." };

    if (!Array.isArray(ids)) return { success: false, error: "Choose at least one proposal." };

    const uniqueIds = [
      ...new Set(ids.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean)),
    ];
    if (uniqueIds.length === 0) return { success: false, error: "Select at least one proposal." };

    const adminService = getAdminPB();
    await Promise.all(
      uniqueIds.map((id) => adminService.updateRecord("cfp_submissions", id, { status })),
    );

    return { success: true, data: { updated: uniqueIds.length } };
  } catch (error) {
    console.error("Admin bulk set submission status error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

// --- CfP Config (conference_config singleton) ---

export type CfpConfigData = {
  cfp_open: boolean;
  cfp_deadline: string | null;
};

export const adminFetchCfpConfig = async () => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const records = await adminService.fetchAllRecords("conference_config");
    if (records.length === 0) {
      return { success: true, data: { cfp_open: true, cfp_deadline: "2026-07-30" } };
    }
    const r = records[0] as any;
    return {
      success: true,
      data: { cfp_open: r.cfp_open ?? true, cfp_deadline: r.cfp_deadline ?? null },
    };
  } catch (error) {
    console.error("Admin fetch CfP config error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export const adminUpdateCfpConfig = async (data: Partial<CfpConfigData>) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const records = await adminService.fetchAllRecords("conference_config");
    if (records.length === 0) {
      const created = await adminService.createRecord("conference_config", data);
      return { success: true, data: created };
    }
    const updated = await adminService.updateRecord(
      "conference_config",
      records[0].id,
      data,
    );
    return { success: true, data: updated };
  } catch (error) {
    console.error("Admin update CfP config error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

// --- Partners & Sponsors ---

export const adminFetchPartners = async () => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const data = (await adminService.fetchAllRecords("partners")) as PartnerRecord[];
    data.sort((a, b) => a.created.localeCompare(b.created));
    return { success: true, data };
  } catch (error) {
    console.error("Admin fetch partners error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export const adminCreatePartner = async (input: PartnerInput) => {
  "use server";
  try {
    await requireAdmin();
    const validationError = validatePartnerInput(input, true);
    if (validationError) return { success: false, error: validationError };

    const adminService = getAdminPB();
    const fields = normalizedPartnerFields(input);
    const body = buildPartnerBody(fields, input.logo);
    const record = (await adminService.createRecord("partners", body)) as PartnerRecord;
    return { success: true, data: partnerSnapshot(record) };
  } catch (error) {
    console.error("Admin create partner error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export const adminUpdatePartner = async (id: string, input: PartnerInput) => {
  "use server";
  try {
    await requireAdmin();
    const validationError = validatePartnerInput(input, false);
    if (validationError) return { success: false, error: validationError };

    const adminService = getAdminPB();
    const fields = normalizedPartnerFields(input);
    const body = buildPartnerBody(fields, input.logo);
    const record = (await adminService.updateRecord("partners", id, body)) as PartnerRecord;
    return { success: true, data: partnerSnapshot(record) };
  } catch (error) {
    console.error("Admin update partner error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export const adminSetPartnerPublished = async (id: string, published: boolean) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const record = (await adminService.updateRecord("partners", id, { published })) as PartnerRecord;
    return { success: true, data: partnerSnapshot(record) };
  } catch (error) {
    console.error("Admin set partner published error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export const adminDeletePartner = async (id: string) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    await adminService.deleteRecord("partners", id);
    return { success: true };
  } catch (error) {
    console.error("Admin delete partner error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

// --- Speakers & Sessions (public programme) ---

export const adminFetchSpeakers = async () => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const data = await adminService.fetchAllRecords("speakers", {
      expand: "cfp_applicant.user,user",
      sort: "slug",
    });
    return { success: true, data };
  } catch (error) {
    console.error("Admin fetch speakers error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export const adminFetchSessions = async () => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const data = await adminService.fetchAllRecords("sessions", {
      expand: "speakers",
      sort: "title",
    });
    return { success: true, data };
  } catch (error) {
    console.error("Admin fetch sessions error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

/** Create an unpublished CFP-origin speaker profile from an accepted applicant. */
export const adminPublishFromApplicant = async (applicantId: string) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await createOrReuseCfpSpeakerFromApplicant(adminService, applicantId);
    return {
      success: true,
      data: speakerSnapshot(result.speaker),
      created: result.created,
    };
  } catch (error) {
    console.error("Admin create speaker from applicant error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

/** @deprecated Use adminPublishFromApplicant */
export const adminCreateSpeakerFromApplicant = adminPublishFromApplicant;

export const adminPromoteSubmissionToDraftSession = async (submissionId: string) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const data = await promoteSubmissionToDraftSession(adminService, submissionId);
    return { success: true, data };
  } catch (error) {
    console.error("Admin promote submission to draft session error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export type InviteSpeakerInput = {
  slug: string;
  display_name: string;
  affiliation: string;
  bio: string;
  social_handles: string[];
  photo?: InviteSpeakerPhotoPayload | null;
};

export const adminCreateInviteSpeaker = async (input: InviteSpeakerInput) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();

    const displayName = input.display_name?.trim();
    if (!displayName) {
      return { success: false, error: "Display name is required." };
    }

    if (input.photo?.data?.length) {
      const photoError = validateSpeakerPhotoUpload(input.photo);
      if (photoError) return { success: false, error: photoError };
    }

    const slugExists = async (candidate: string) => {
      const hits = await adminService.fetchAllRecords("speakers", {
        filter: `slug = "${candidate}"`,
        fields: "id",
      });
      return hits.length > 0;
    };

    const baseSlug = slugify(input.slug || displayName) || "speaker";
    const slug = await uniqueSpeakerSlug(baseSlug, slugExists);

    const fields = {
      slug,
      published: false,
      origin: "invite",
      display_name: displayName,
      affiliation: input.affiliation?.trim() || "",
      bio: input.bio?.trim() || "",
      social_handles: normalizeSpeakerSocialHandles(input.social_handles),
    };

    const body = buildSpeakerCreateBody(fields, input.photo);
    const record = (await adminService.createRecord("speakers", body)) as SpeakerRecord;
    return { success: true, data: speakerSnapshot(record) };
  } catch (error) {
    console.error("Admin create invite speaker error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export const adminUpdateSpeakerProfile = async (
  id: string,
  input: SpeakerProfileUpdateInput,
) => {
  "use server";
  try {
    await requireAdmin();
    const normalized = normalizeSpeakerProfileUpdateInput(input);
    if (!normalized.success) return normalized;

    const adminService = getAdminPB();
    if (await speakerSlugExistsForOther(adminService, normalized.data.fields.slug, id)) {
      return {
        success: false,
        error: "Slug is already used by another speaker. Choose a different slug.",
      };
    }

    const body = buildSpeakerProfileUpdateBody(
      normalized.data.fields,
      normalized.data.photo,
    );
    const record = (await adminService.updateRecord("speakers", id, body)) as SpeakerRecord;
    return { success: true, data: speakerSnapshot(record) };
  } catch (error) {
    console.error("Admin update speaker profile error:", error);
    if (isDuplicateFieldError(error, "slug")) {
      return {
        success: false,
        error: "Slug is already used by another speaker. Choose a different slug.",
      };
    }
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export const adminSetSpeakerPublished = async (id: string, published: boolean) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const record = (await adminService.updateRecord("speakers", id, { published })) as SpeakerRecord;
    return { success: true, data: speakerSnapshot(record) };
  } catch (error) {
    console.error("Admin set speaker publication error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

export type SessionInput = SessionEditableInput & {
  slug: string;
  title: string;
  abstract: string;
  speakers: string[];
};

export type SessionUpdateInput = SessionEditableInput;

export const adminCreateSession = async (input: SessionInput) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const record = await adminService.createRecord("sessions", buildSessionCreateBody(input));
    return { success: true, data: record };
  } catch (error) {
    console.error("Admin create session error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminUpdateSession = async (id: string, data: SessionUpdateInput) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.updateRecord("sessions", id, buildSessionUpdateBody(data));
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin update session error:", error);
    return { success: false, error: (error as Error).message };
  }
};

export const adminSetSessionPublished = async (id: string, published: boolean) => {
  "use server";
  try {
    await requireAdmin();
    return {
      success: false,
      error: "Session publication is managed from its Agenda Slot.",
    };
  } catch (error) {
    console.error("Admin set session published error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

/** Clears verified legacy Session schedule values after their Slot has been mapped. */
export const adminClearSessionLegacySchedule = async (id: string) => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();
    const result = await adminService.updateRecord("sessions", id, {
      starts_at: "",
      track: "",
      room: "",
    });
    return { success: true, data: result };
  } catch (error) {
    console.error("Admin clear legacy Session schedule error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

async function fetchAcceptedCfpSubmissions(adminService: ReturnType<typeof getAdminPB>): Promise<{
  submissions: any[];
  warning?: string;
}> {
  try {
    const submissions = await adminService.fetchAllRecords("cfp_submissions", {
      filter: 'status = "accepted"',
      expand: "applicant.user",
    });
    return { submissions };
  } catch (filterError) {
    console.warn(
      "Accepted CFP status filter failed; falling back to client-side filter:",
      filterError,
    );
    const allSubmissions = (await adminService.fetchAllRecords("cfp_submissions", {
      expand: "applicant.user",
      sort: "-created",
    })) as Array<{ status?: string }>;
    return {
      submissions: allSubmissions.filter(
        (sub: { status?: string }) => (sub.status || "pending") === "accepted",
      ),
      warning:
        "Could not filter accepted CFP submissions in PocketBase (status field may be missing). Run migrations and mark submissions as accepted.",
    };
  }
}

export const adminFetchAcceptedApplicantsWithoutSpeaker = async () => {
  "use server";
  try {
    await requireAdmin();
    const adminService = getAdminPB();

    const [{ submissions: acceptedSubs, warning }, speakers] = await Promise.all([
      fetchAcceptedCfpSubmissions(adminService),
      adminService.fetchAllRecords("speakers", { fields: "cfp_applicant" }),
    ]);

    const linkedApplicantIds = new Set(
      speakers.map((s: any) => s.cfp_applicant).filter(Boolean),
    );

    const byApplicant = new Map<string, any>();
    for (const sub of acceptedSubs as any[]) {
      const applicantId = sub.applicant;
      if (!applicantId || linkedApplicantIds.has(applicantId)) continue;
      if (!byApplicant.has(applicantId)) {
        byApplicant.set(applicantId, {
          applicantId,
          applicant: sub.expand?.applicant,
          submissionTitle: sub.session_title,
        });
      }
    }

    return { success: true, data: Array.from(byApplicant.values()), warning };
  } catch (error) {
    console.error("Admin fetch accepted without speaker error:", error);
    return { success: false, error: pbAdminErrorMessage(error) };
  }
};

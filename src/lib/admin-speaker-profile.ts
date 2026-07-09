import { uniqueSpeakerSlug } from "~/lib/conference-slug";
import type {
  CfpApplicantRecord,
  SpeakerRecord,
  UserRecord,
} from "~/lib/pocketbase-types";

const SPEAKER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const SPEAKER_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const SPEAKER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AdminSpeakerService = {
  fetchAllRecords(collectionName: string, options?: unknown): Promise<unknown[]>;
  fetchRecordById(collectionName: string, id: string, options?: unknown): Promise<unknown>;
  createRecord(collectionName: string, data: unknown): Promise<unknown>;
  updateRecord(collectionName: string, id: string, data: unknown): Promise<unknown>;
  getInstance(): Promise<{
    authStore: { token?: string };
    files: { getURL(record: object, filename: string): string };
  }>;
};

/** Serializable file payload for speaker photos (Seroval-safe). */
export type SpeakerPhotoPayload = {
  name: string;
  type: string;
  data: number[];
};

export type SpeakerProfilePhotoInput =
  | { intent: "keep" }
  | { intent: "remove" }
  | { intent: "replace"; file: SpeakerPhotoPayload };

export type SpeakerProfileUpdateInput = {
  display_name: string;
  slug: string;
  affiliation?: string;
  bio?: string;
  social_handles?: string[];
  photo?: SpeakerProfilePhotoInput;
};

type SpeakerPhotoBlobPayload = {
  name: string;
  type: string;
  blob: Blob;
};

type SpeakerPhotoUpload = SpeakerPhotoPayload | SpeakerPhotoBlobPayload;

type NormalizedSpeakerProfile = {
  fields: {
    display_name: string;
    slug: string;
    affiliation: string;
    bio: string;
    social_handles: string[];
  };
  photo: SpeakerProfilePhotoInput;
};

function quotePbString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function speakerPhotoMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "";
}

function normalizedSpeakerPhotoMime(name: string, type?: string | null): string {
  const mime = (type || "").split(";")[0].trim().toLowerCase();
  if (SPEAKER_PHOTO_TYPES.includes(mime)) return mime;
  return speakerPhotoMimeFromName(name);
}

function speakerPhotoSize(photo: SpeakerPhotoUpload): number {
  return "blob" in photo ? photo.blob.size : photo.data.length;
}

function speakerPhotoBlob(photo: SpeakerPhotoUpload): Blob {
  if ("blob" in photo) return photo.blob;
  return new Blob([new Uint8Array(photo.data)], {
    type: normalizedSpeakerPhotoMime(photo.name, photo.type) || "application/octet-stream",
  });
}

export function validateSpeakerPhotoUpload(photo: SpeakerPhotoUpload): string | null {
  if (speakerPhotoSize(photo) > SPEAKER_PHOTO_MAX_BYTES) {
    return "Photo must be 5 MB or smaller.";
  }
  const mime = normalizedSpeakerPhotoMime(photo.name, photo.type);
  if (!SPEAKER_PHOTO_TYPES.includes(mime)) {
    return "Photo must be JPEG, PNG, or WebP.";
  }
  return null;
}

export async function speakerFileToPhotoPayload(
  file: File | null,
): Promise<SpeakerPhotoPayload | null> {
  if (!file) return null;
  if (file.size === 0) throw new Error("Photo must not be empty.");

  const payload = {
    name: file.name,
    type: file.type,
    data: Array.from(new Uint8Array(await file.arrayBuffer())),
  };
  const error = validateSpeakerPhotoUpload(payload);
  if (error) throw new Error(error);
  return payload;
}

export function normalizeSpeakerSocialHandles(raw: unknown): string[] {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function validateSpeakerSlug(slug: string): string | null {
  if (!slug) return "Slug is required.";
  if (slug.length > 80) return "Slug must be 80 characters or fewer.";
  if (!SPEAKER_SLUG_PATTERN.test(slug)) {
    return "Slug must use lowercase letters, numbers, and single hyphens only.";
  }
  return null;
}

export function normalizeSpeakerProfileUpdateInput(
  input: SpeakerProfileUpdateInput,
): { success: true; data: NormalizedSpeakerProfile } | { success: false; error: string } {
  const displayName = input.display_name?.trim() || "";
  if (!displayName) return { success: false, error: "Display name is required." };

  const slug = input.slug?.trim() || "";
  const slugError = validateSpeakerSlug(slug);
  if (slugError) return { success: false, error: slugError };

  const photo = input.photo || { intent: "keep" };
  if (photo.intent === "replace") {
    if (!photo.file?.data?.length) {
      return { success: false, error: "Choose a photo to upload." };
    }
    const photoError = validateSpeakerPhotoUpload(photo.file);
    if (photoError) return { success: false, error: photoError };
  }

  return {
    success: true,
    data: {
      fields: {
        display_name: displayName,
        slug,
        affiliation: input.affiliation?.trim() || "",
        bio: input.bio?.trim() || "",
        social_handles: normalizeSpeakerSocialHandles(input.social_handles),
      },
      photo,
    },
  };
}

export function isDuplicateFieldError(error: unknown, field: string): boolean {
  const response = (error as { response?: { data?: Record<string, { message?: string }> } })
    ?.response;
  const fieldMessage = response?.data?.[field]?.message;
  const message = error instanceof Error ? error.message : String(error || "");
  const combined = `${fieldMessage || ""} ${message}`.toLowerCase();
  return (
    combined.includes(field.toLowerCase()) &&
    (combined.includes("unique") ||
      combined.includes("already") ||
      combined.includes("constraint"))
  );
}

export function speakerSnapshot(record: SpeakerRecord) {
  return {
    id: record.id,
    slug: record.slug,
    display_name: record.display_name || "",
    origin: record.origin,
    published: record.published,
    user: record.user || "",
    cfp_applicant: record.cfp_applicant || "",
    photo: record.photo || "",
    affiliation: record.affiliation || "",
    bio: record.bio || "",
    social_handles: normalizeSpeakerSocialHandles(record.social_handles),
  };
}

export function buildSpeakerCreateBody(
  fields: Record<string, string | boolean | string[]>,
  photo?: SpeakerPhotoUpload | null,
): Record<string, unknown> | FormData {
  if (!photo || speakerPhotoSize(photo) === 0) return fields;

  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (key === "social_handles") {
      body.append(key, JSON.stringify(value));
    } else {
      body.append(key, String(value));
    }
  }
  body.append("photo", speakerPhotoBlob(photo), photo.name || "photo");
  return body;
}

export function buildSpeakerProfileUpdateBody(
  fields: NormalizedSpeakerProfile["fields"],
  photo: SpeakerProfilePhotoInput,
): Record<string, unknown> | FormData {
  if (photo.intent !== "replace") {
    return photo.intent === "remove" ? { ...fields, photo: "" } : fields;
  }

  return buildSpeakerCreateBody(fields, photo.file);
}

export async function speakerSlugExistsForOther(
  adminService: AdminSpeakerService,
  slug: string,
  speakerId: string,
): Promise<boolean> {
  const hits = (await adminService.fetchAllRecords("speakers", {
    filter: `slug = "${quotePbString(slug)}"`,
    fields: "id",
  })) as Pick<SpeakerRecord, "id">[];
  return hits.some((hit) => hit.id !== speakerId);
}

type ExpandedCfpApplicantRecord = CfpApplicantRecord & {
  expand?: { user?: UserRecord };
};

async function findSpeakerByCfpApplicant(
  adminService: AdminSpeakerService,
  applicantId: string,
): Promise<SpeakerRecord | null> {
  const existing = (await adminService.fetchAllRecords("speakers", {
    filter: `cfp_applicant = "${quotePbString(applicantId)}"`,
  })) as SpeakerRecord[];
  return existing[0] || null;
}

async function userAvatarPhotoUpload(
  adminService: AdminSpeakerService,
  user?: UserRecord,
): Promise<SpeakerPhotoBlobPayload | null> {
  if (!user) return null;
  const avatar = user?.avatar?.trim();
  if (!avatar) return null;

  try {
    const pb = await adminService.getInstance();
    const url = pb.files.getURL(user, avatar);
    const headers: HeadersInit = pb.authStore.token
      ? { Authorization: `Bearer ${pb.authStore.token}` }
      : {};
    const response = await fetch(url, { headers });
    if (!response.ok) return null;

    const blob = await response.blob();
    const type = normalizedSpeakerPhotoMime(
      avatar,
      blob.type || response.headers.get("content-type"),
    );
    const photo = { name: avatar, type, blob };
    return validateSpeakerPhotoUpload(photo) ? null : photo;
  } catch {
    return null;
  }
}

export async function createOrReuseCfpSpeakerFromApplicant(
  adminService: AdminSpeakerService,
  applicantId: string,
): Promise<{ speaker: SpeakerRecord; created: boolean }> {
  const existing = await findSpeakerByCfpApplicant(adminService, applicantId);
  if (existing) return { speaker: existing, created: false };

  const applicant = (await adminService.fetchRecordById("cfp_applicants", applicantId, {
    expand: "user",
  })) as ExpandedCfpApplicantRecord;
  const user = applicant.expand?.user;
  const displayName = user?.name?.trim() || "";
  const baseName = displayName || user?.email?.trim() || "speaker";

  const slug = await uniqueSpeakerSlug(baseName, (candidate) =>
    speakerSlugExistsForOther(adminService, candidate, ""),
  );

  const fields = {
    slug,
    published: false,
    origin: "cfp",
    cfp_applicant: applicantId,
    user: applicant.user || "",
    display_name: displayName,
    affiliation: applicant.affiliation?.trim() || "",
    bio: applicant.bio?.trim() || "",
    social_handles: normalizeSpeakerSocialHandles(applicant.social_handles),
  };

  const photo = await userAvatarPhotoUpload(adminService, user);
  const body = buildSpeakerCreateBody(fields, photo);

  try {
    const speaker = (await adminService.createRecord("speakers", body)) as SpeakerRecord;
    return { speaker, created: true };
  } catch (error) {
    if (isDuplicateFieldError(error, "cfp_applicant")) {
      const racedExisting = await findSpeakerByCfpApplicant(adminService, applicantId);
      if (racedExisting) return { speaker: racedExisting, created: false };
      throw new Error(
        "A speaker profile already exists for this CFP applicant. Refresh Speakers and try again.",
      );
    }
    throw error;
  }
}

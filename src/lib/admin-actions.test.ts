import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const fetchAllRecords = vi.fn();
  const fetchRecordById = vi.fn();
  const createRecord = vi.fn();
  const updateRecord = vi.fn();
  const getInstance = vi.fn();
  return {
    fetchAllRecords,
    fetchRecordById,
    createRecord,
    updateRecord,
    getInstance,
    adminService: {
      fetchAllRecords,
      fetchRecordById,
      createRecord,
      updateRecord,
      getInstance,
    },
  };
});

import {
  buildSpeakerProfileUpdateBody,
  createOrReuseCfpSpeakerFromApplicant,
  normalizeSpeakerProfileUpdateInput,
  normalizeSpeakerSocialHandles,
  speakerFileToPhotoPayload,
  speakerSlugExistsForOther,
} from "~/lib/admin-speaker-profile";
import {
  addPromotedSessionSummaries,
  buildSessionCreateBody,
  buildSessionUpdateBody,
  promoteSubmissionToDraftSession,
} from "~/lib/admin-session-promotion";

const timestamp = "2026-01-01 00:00:00.000Z";
const originalFetch = globalThis.fetch;
const {
  fetchAllRecords,
  fetchRecordById,
  createRecord,
  updateRecord,
  getInstance,
  adminService,
} = mocks;

function speaker(overrides: Record<string, unknown> = {}) {
  return {
    id: "speaker-1",
    slug: "ada-lovelace",
    published: false,
    origin: "cfp",
    display_name: "Ada Lovelace",
    user: "user-1",
    cfp_applicant: "applicant-1",
    photo: "",
    affiliation: "Example Co",
    bio: "Bio",
    social_handles: ["@ada"],
    created: timestamp,
    updated: timestamp,
    ...overrides,
  };
}

function applicant() {
  return {
    id: "applicant-1",
    affiliation: " Example Co ",
    bio: " Speaker bio ",
    social_handles: [" @ada ", "", "https://example.com"],
    preferred_contact_method: "email",
    user: "user-1",
    created: timestamp,
    updated: timestamp,
    expand: {
      user: {
        id: "user-1",
        email: "ada@example.com",
        emailVisibility: false,
        username: "ada",
        name: " Ada Lovelace ",
        avatar: "avatar.jpg",
        role: "user",
        created: timestamp,
        updated: timestamp,
      },
    },
  };
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: "submission-1",
    session_title: "Practical Type Safety",
    abstract: "Public abstract",
    key_takeaways: "Private takeaways",
    technical_requirements: "Private technical notes",
    notes: "Private CFP notes",
    meta: { private: true },
    applicant: "applicant-1",
    status: "accepted",
    created: timestamp,
    updated: timestamp,
    expand: {
      applicant: applicant(),
    },
    ...overrides,
  };
}

function draftSession(overrides: Record<string, unknown> = {}) {
  return {
    collectionId: "sessions",
    collectionName: "sessions",
    id: "session-1",
    slug: "practical-type-safety",
    published: false,
    title: "Practical Type Safety",
    abstract: "Public abstract",
    format: "",
    starts_at: "",
    track: "",
    room: "",
    speakers: ["speaker-1"],
    cfp_submission: "submission-1",
    created: timestamp,
    updated: timestamp,
    ...overrides,
  };
}

function mockSpeakerLookups(existingByApplicant: unknown[] = [], slugHits: unknown[] = []) {
  fetchAllRecords.mockImplementation((collection: string, options?: { filter?: string }) => {
    if (collection !== "speakers") return Promise.resolve([]);
    if (options?.filter?.includes("cfp_applicant")) return Promise.resolve(existingByApplicant);
    if (options?.filter?.includes("slug")) return Promise.resolve(slugHits);
    return Promise.resolve([]);
  });
}

describe("admin speaker profile helpers", () => {
  beforeEach(() => {
    fetchAllRecords.mockReset();
    fetchRecordById.mockReset();
    createRecord.mockReset();
    updateRecord.mockReset();
    getInstance.mockReset();
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("validates profile fields and normalizes social handles", () => {
    expect(
      normalizeSpeakerProfileUpdateInput({
        display_name: "",
        slug: "ada",
        social_handles: [],
      }),
    ).toMatchObject({ success: false, error: "Display name is required." });

    expect(
      normalizeSpeakerProfileUpdateInput({
        display_name: "Ada",
        slug: "Ada Lovelace",
        social_handles: [],
      }),
    ).toMatchObject({ success: false });

    expect(
      normalizeSpeakerProfileUpdateInput({
        display_name: "Ada",
        slug: "ada-lovelace",
        social_handles: [],
        photo: { intent: "replace", file: { name: "avatar.gif", type: "image/gif", data: [1] } },
      }),
    ).toMatchObject({ success: false, error: "Photo must be JPEG, PNG, or WebP." });

    const normalized = normalizeSpeakerProfileUpdateInput({
      display_name: " Ada Lovelace ",
      slug: "ada-lovelace",
      affiliation: " Example Co ",
      bio: " Bio ",
      social_handles: [" @ada ", "", "https://example.com"],
    });

    expect(normalized).toMatchObject({
      success: true,
      data: {
        fields: {
          display_name: "Ada Lovelace",
          slug: "ada-lovelace",
          affiliation: "Example Co",
          bio: "Bio",
          social_handles: ["@ada", "https://example.com"],
        },
      },
    });
    expect(normalizeSpeakerSocialHandles([" x ", null, "", " y "])).toEqual(["x", "y"]);
  });

  it("converts selected photo files and rejects empty file selections", async () => {
    await expect(speakerFileToPhotoPayload(null)).resolves.toBeNull();
    await expect(
      speakerFileToPhotoPayload(new File([], "empty.webp", { type: "image/webp" })),
    ).rejects.toThrow("Photo must not be empty.");

    await expect(
      speakerFileToPhotoPayload(
        new File([new Uint8Array([1, 2, 3])], "avatar.webp", { type: "image/webp" }),
      ),
    ).resolves.toEqual({
      name: "avatar.webp",
      type: "image/webp",
      data: [1, 2, 3],
    });
  });

  it("detects duplicate slugs while excluding the speaker being edited", async () => {
    fetchAllRecords.mockResolvedValue([{ id: "other-speaker" }]);

    await expect(
      speakerSlugExistsForOther(adminService, "ada-lovelace", "speaker-1"),
    ).resolves.toBe(true);

    fetchAllRecords.mockResolvedValue([{ id: "speaker-1" }]);

    await expect(
      speakerSlugExistsForOther(adminService, "ada-lovelace", "speaker-1"),
    ).resolves.toBe(false);
  });

  it("builds explicit photo removal without a replacement upload", () => {
    const normalized = normalizeSpeakerProfileUpdateInput({
      display_name: "Ada Lovelace",
      slug: "ada-lovelace",
      affiliation: "",
      bio: "",
      social_handles: ["", " @ada "],
      photo: { intent: "remove" },
    });

    expect(normalized.success).toBe(true);
    if (!normalized.success) throw new Error(normalized.error);

    expect(buildSpeakerProfileUpdateBody(normalized.data.fields, normalized.data.photo)).toEqual({
      display_name: "Ada Lovelace",
      slug: "ada-lovelace",
      affiliation: "",
      bio: "",
      social_handles: ["@ada"],
      photo: "",
    });
  });

  it("reuses an existing CFP-origin speaker before reading source records", async () => {
    mockSpeakerLookups([speaker()]);

    const result = await createOrReuseCfpSpeakerFromApplicant(adminService, "applicant-1");

    expect(result).toMatchObject({ created: false, speaker: expect.objectContaining({ id: "speaker-1" }) });
    expect(fetchAllRecords).toHaveBeenCalledWith("speakers", {
      filter: 'cfp_applicant = "applicant-1"',
    });
    expect(fetchRecordById).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("creates a CFP-origin draft speaker from resolved snapshot fields and user avatar", async () => {
    mockSpeakerLookups([], []);
    fetchRecordById.mockResolvedValue(applicant());
    getInstance.mockResolvedValue({
      authStore: { token: "admin-token" },
      files: { getURL: vi.fn(() => "https://files.example/avatar.jpg") },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    createRecord.mockResolvedValue(speaker());

    const result = await createOrReuseCfpSpeakerFromApplicant(adminService, "applicant-1");

    expect(result.created).toBe(true);
    expect(createRecord).toHaveBeenCalledOnce();
    const body = createRecord.mock.calls[0][1] as FormData;
    expect(createRecord.mock.calls[0][0]).toBe("speakers");
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("display_name")).toBe("Ada Lovelace");
    expect(body.get("affiliation")).toBe("Example Co");
    expect(body.get("bio")).toBe("Speaker bio");
    expect(body.get("published")).toBe("false");
    expect(body.get("origin")).toBe("cfp");
    expect(body.get("social_handles")).toBe(JSON.stringify(["@ada", "https://example.com"]));
    expect(body.get("photo")).toBeTruthy();
  });

  it("handles the CFP Applicant unique-index race by returning the raced speaker", async () => {
    let applicantLookupCount = 0;
    fetchAllRecords.mockImplementation((collection: string, options?: { filter?: string }) => {
      if (collection !== "speakers") return Promise.resolve([]);
      if (options?.filter?.includes("cfp_applicant")) {
        applicantLookupCount += 1;
        return Promise.resolve(applicantLookupCount === 1 ? [] : [speaker({ id: "raced-speaker" })]);
      }
      return Promise.resolve([]);
    });
    fetchRecordById.mockResolvedValue(applicant());
    getInstance.mockResolvedValue({
      authStore: { token: "" },
      files: { getURL: vi.fn(() => "https://files.example/avatar.jpg") },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    createRecord.mockRejectedValue(new Error("UNIQUE constraint failed: speakers.cfp_applicant"));

    const result = await createOrReuseCfpSpeakerFromApplicant(adminService, "applicant-1");

    expect(result).toMatchObject({
      created: false,
      speaker: expect.objectContaining({ id: "raced-speaker" }),
    });
  });
});

describe("admin CFP promotion helpers", () => {
  beforeEach(() => {
    fetchAllRecords.mockReset();
    fetchRecordById.mockReset();
    createRecord.mockReset();
    updateRecord.mockReset();
    getInstance.mockReset();
    globalThis.fetch = originalFetch;
  });

  it("rejects non-accepted submissions before creating public records", async () => {
    fetchRecordById.mockResolvedValue(submission({ status: "pending" }));

    await expect(
      promoteSubmissionToDraftSession(adminService, "submission-1"),
    ).rejects.toThrow("accepted");

    expect(fetchRecordById).toHaveBeenCalledWith("cfp_submissions", "submission-1", {
      expand: "applicant.user",
    });
    expect(fetchAllRecords).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("rejects accepted submissions without a linked CFP Applicant", async () => {
    fetchRecordById.mockResolvedValue(submission({ applicant: "", expand: {} }));

    await expect(
      promoteSubmissionToDraftSession(adminService, "submission-1"),
    ).rejects.toThrow("missing a linked CFP Applicant");

    expect(createRecord).not.toHaveBeenCalled();
  });

  it("prevents duplicate promotion before creating a Speaker or Session", async () => {
    fetchRecordById.mockResolvedValue(submission());
    fetchAllRecords.mockImplementation((collection: string, options?: { filter?: string }) => {
      if (collection === "sessions" && options?.filter?.includes("cfp_submission")) {
        return Promise.resolve([draftSession()]);
      }
      return Promise.resolve([]);
    });

    await expect(
      promoteSubmissionToDraftSession(adminService, "submission-1"),
    ).rejects.toThrow("already has a draft Session");

    expect(fetchAllRecords).toHaveBeenCalledWith("sessions", {
      filter: 'cfp_submission = "submission-1"',
      fields: "id,slug,title,published,cfp_submission",
    });
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("reuses an existing Speaker and copies only public Session fields", async () => {
    fetchRecordById.mockResolvedValue(submission());
    fetchAllRecords.mockImplementation((collection: string, options?: { filter?: string }) => {
      const filter = options?.filter || "";
      if (collection === "sessions" && filter.includes("cfp_submission")) {
        return Promise.resolve([]);
      }
      if (collection === "sessions" && filter.includes("slug")) {
        return Promise.resolve([]);
      }
      if (collection === "speakers" && filter.includes("cfp_applicant")) {
        return Promise.resolve([speaker({ id: "speaker-existing" })]);
      }
      return Promise.resolve([]);
    });
    createRecord.mockImplementation((collection: string, body: Record<string, unknown>) => {
      if (collection !== "sessions") throw new Error(`Unexpected create in ${collection}`);
      return Promise.resolve(draftSession({ id: "session-created", ...body }));
    });

    const result = await promoteSubmissionToDraftSession(adminService, "submission-1");

    expect(result).toMatchObject({
      speakerCreated: false,
      session: {
        id: "session-created",
        editHref: "/admin/sessions?edit=session-created",
      },
      speaker: { id: "speaker-existing" },
    });
    expect(createRecord).toHaveBeenCalledOnce();
    expect(createRecord.mock.calls[0][0]).toBe("sessions");
    expect(createRecord.mock.calls[0][1]).toEqual({
      slug: "practical-type-safety",
      title: "Practical Type Safety",
      abstract: "Public abstract",
      format: "",
      starts_at: "",
      track: "",
      room: "",
      speakers: ["speaker-existing"],
      published: false,
      cfp_submission: "submission-1",
    });
    expect(createRecord.mock.calls[0][1]).not.toHaveProperty("key_takeaways");
    expect(createRecord.mock.calls[0][1]).not.toHaveProperty("technical_requirements");
    expect(createRecord.mock.calls[0][1]).not.toHaveProperty("notes");
    expect(createRecord.mock.calls[0][1]).not.toHaveProperty("meta");
  });

  it("creates a reused-snapshot Speaker when needed and generates a unique Session slug", async () => {
    const sourceApplicant = applicant();
    sourceApplicant.expand.user.avatar = "";
    fetchRecordById.mockImplementation((collection: string) => {
      if (collection === "cfp_submissions") return Promise.resolve(submission());
      if (collection === "cfp_applicants") return Promise.resolve(sourceApplicant);
      return Promise.reject(new Error(`Unexpected fetch in ${collection}`));
    });
    fetchAllRecords.mockImplementation((collection: string, options?: { filter?: string }) => {
      const filter = options?.filter || "";
      if (collection === "sessions" && filter.includes("cfp_submission")) return Promise.resolve([]);
      if (collection === "sessions" && filter.includes('slug = "practical-type-safety"')) {
        return Promise.resolve([draftSession({ id: "slug-conflict" })]);
      }
      if (collection === "sessions" && filter.includes('slug = "practical-type-safety-2"')) {
        return Promise.resolve([]);
      }
      if (collection === "speakers") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    createRecord.mockImplementation((collection: string, body: Record<string, unknown>) => {
      if (collection === "speakers") return Promise.resolve(speaker({ id: "speaker-created" }));
      if (collection === "sessions") return Promise.resolve(draftSession({ id: "session-created", ...body }));
      return Promise.reject(new Error(`Unexpected create in ${collection}`));
    });

    const result = await promoteSubmissionToDraftSession(adminService, "submission-1");

    expect(result.speakerCreated).toBe(true);
    const sessionCreate = createRecord.mock.calls.find(([collection]) => collection === "sessions");
    expect(sessionCreate?.[1]).toMatchObject({
      slug: "practical-type-safety-2",
      speakers: ["speaker-created"],
    });
  });

  it("handles the Session CFP provenance unique-index race as a duplicate", async () => {
    let promotionLookups = 0;
    fetchRecordById.mockResolvedValue(submission());
    fetchAllRecords.mockImplementation((collection: string, options?: { filter?: string }) => {
      const filter = options?.filter || "";
      if (collection === "sessions" && filter.includes("cfp_submission")) {
        promotionLookups += 1;
        return Promise.resolve(promotionLookups === 1 ? [] : [draftSession({ id: "raced-session" })]);
      }
      if (collection === "sessions" && filter.includes("slug")) return Promise.resolve([]);
      if (collection === "speakers" && filter.includes("cfp_applicant")) return Promise.resolve([speaker()]);
      return Promise.resolve([]);
    });
    createRecord.mockRejectedValue(new Error("UNIQUE constraint failed: sessions.cfp_submission"));

    await expect(
      promoteSubmissionToDraftSession(adminService, "submission-1"),
    ).rejects.toThrow("already has a draft Session");

    expect(promotionLookups).toBe(2);
  });

  it("adds promoted Session summaries to leaderboard rows", () => {
    const rows = addPromotedSessionSummaries(
      [submission({ id: "submission-1" }), submission({ id: "submission-2" })],
      [
        draftSession({
          id: "session-2",
          cfp_submission: "submission-2",
          title: "Accepted Session",
          slug: "accepted-session",
          published: true,
        }),
      ],
    );

    expect(rows[0].promotedSession).toBeNull();
    expect(rows[1].promotedSession).toEqual({
      id: "session-2",
      slug: "accepted-session",
      title: "Accepted Session",
      published: true,
      editHref: "/admin/sessions?edit=session-2",
    });
  });

  it("keeps ordinary Session writes from setting CFP provenance", () => {
    const createBody = buildSessionCreateBody({
      slug: "manual-session",
      title: "Manual Session",
      abstract: "Abstract",
      speakers: [],
      cfp_submission: "submission-1",
    } as any);
    const updateBody = buildSessionUpdateBody({
      title: "Updated Session",
      cfp_submission: "submission-1",
    } as any);

    expect(createBody).not.toHaveProperty("cfp_submission");
    expect(updateBody).toEqual({ slug: "updated-session", title: "Updated Session" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const requireAuth = vi.fn();
  const fetchAllRecords = vi.fn();
  const createRecord = vi.fn();
  return {
    requireAuth,
    fetchAllRecords,
    createRecord,
    adminService: { fetchAllRecords, createRecord },
  };
});

vi.mock("~/lib/server-auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("~/lib/pocketbase-admin-service", () => ({ getAdminPB: () => mocks.adminService }));

import { saveMyCfpSubmissionCore } from "~/lib/cfp-actions";

const applicantId = "aaaaaaaaaaaaaaa";
const input = {
  session_title: "Safe server actions",
  abstract: "A useful abstract",
  key_takeaways: "A useful takeaway",
  technical_requirements: "Projector",
  meta: {},
};

describe("CFP submission DTO", () => {
  beforeEach(() => {
    mocks.requireAuth.mockReset().mockResolvedValue({ id: "user-00000000001" });
    mocks.fetchAllRecords.mockReset()
      .mockResolvedValueOnce([{ availability: { cfp: true, review: false }, cfp_open: true }])
      .mockResolvedValueOnce([{ id: applicantId, user: "user-00000000001", bio: "Bio", social_handles: ["@a", 3] }]);
    mocks.createRecord.mockReset();
  });

  const expectedApplicant = {
    id: applicantId,
    user: "user-00000000001",
    affiliation: "",
    bio: "Bio",
    social_handles: ["@a"],
    preferred_contact_method: "",
    previous_talks: "",
  };

  it("fills missing text, meta, and status defaults", async () => {
    mocks.createRecord.mockResolvedValue({ id: 42, applicant: applicantId, meta: "not-an-object", status: "withdrawn" });

    await expect(saveMyCfpSubmissionCore(input)).resolves.toEqual({
      id: "42",
      applicant: applicantId,
      session_title: "",
      abstract: "",
      key_takeaways: "",
      technical_requirements: "",
      notes: "",
      meta: {},
      status: "pending",
      created: "",
      updated: "",
      expand: { applicant: expectedApplicant },
    });
  });

  it("keeps stored values and a final status", async () => {
    mocks.createRecord.mockResolvedValue({
      id: "sssssssssssssss",
      applicant: applicantId,
      ...input,
      notes: "Reviewer-visible",
      meta: { track: "web" },
      status: "rejected",
      created: "2026-01-01 00:00:00.000Z",
      updated: "2026-01-02 00:00:00.000Z",
    });

    await expect(saveMyCfpSubmissionCore(input)).resolves.toEqual({
      id: "sssssssssssssss",
      applicant: applicantId,
      session_title: "Safe server actions",
      abstract: "A useful abstract",
      key_takeaways: "A useful takeaway",
      technical_requirements: "Projector",
      notes: "Reviewer-visible",
      meta: { track: "web" },
      status: "rejected",
      created: "2026-01-01 00:00:00.000Z",
      updated: "2026-01-02 00:00:00.000Z",
      expand: { applicant: expectedApplicant },
    });
  });
});

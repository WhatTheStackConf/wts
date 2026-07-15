import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const requireAuth = vi.fn();
  const fetchAllRecords = vi.fn();
  const fetchRecordById = vi.fn();
  const createRecord = vi.fn();
  const updateRecord = vi.fn();
  return {
    requireAuth,
    fetchAllRecords,
    fetchRecordById,
    createRecord,
    updateRecord,
    adminService: { fetchAllRecords, fetchRecordById, createRecord, updateRecord },
  };
});

vi.mock("~/lib/server-auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("~/lib/pocketbase-admin-service", () => ({ getAdminPB: () => mocks.adminService }));
vi.mock("@solidjs/start/server", () => ({ createServerReference: (fn: unknown) => fn }));

import { saveMyCfpSubmissionCore as saveMyCfpSubmission } from "~/lib/cfp-actions";

const applicantId = "aaaaaaaaaaaaaaa";
const submissionId = "sssssssssssssss";
const input = {
  session_title: "Safe server actions",
  abstract: "A useful abstract",
  key_takeaways: "A useful takeaway",
  technical_requirements: "Projector",
  meta: {},
};

describe("CFP submission server policy", () => {
  beforeEach(() => {
    for (const mock of [
      mocks.requireAuth,
      mocks.fetchAllRecords,
      mocks.fetchRecordById,
      mocks.createRecord,
      mocks.updateRecord,
    ]) mock.mockReset();
    mocks.requireAuth.mockResolvedValue({ id: "user-00000000001" });
  });

  it("rejects writes when the CFP is closed", async () => {
    mocks.fetchAllRecords.mockResolvedValueOnce([{
      cfp_open: false,
      cfp_deadline: "2099-07-30T23:59:59Z",
    }]);

    await expect(saveMyCfpSubmission(input)).rejects.toThrow("The CFP is closed.");
    expect(mocks.createRecord).not.toHaveBeenCalled();
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });

  it("rejects edits to finalized submissions", async () => {
    mocks.fetchAllRecords
      .mockResolvedValueOnce([{ cfp_open: true, cfp_deadline: "2099-07-30T23:59:59Z" }])
      .mockResolvedValueOnce([{ id: applicantId, user: "user-00000000001" }]);
    mocks.fetchRecordById.mockResolvedValue({
      id: submissionId,
      applicant: applicantId,
      status: "accepted",
    });

    await expect(saveMyCfpSubmission({ ...input, id: submissionId }))
      .rejects.toThrow("Finalized CFP submissions cannot be edited.");
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });

  it("creates pending submissions while the CFP is open", async () => {
    mocks.fetchAllRecords
      .mockResolvedValueOnce([{ cfp_open: true, cfp_deadline: "2099-07-30T23:59:59Z" }])
      .mockResolvedValueOnce([{ id: applicantId, user: "user-00000000001" }]);
    mocks.createRecord.mockResolvedValue({
      id: submissionId,
      applicant: applicantId,
      status: "pending",
      ...input,
    });

    await expect(saveMyCfpSubmission(input)).resolves.toMatchObject({
      id: submissionId,
      status: "pending",
    });
    expect(mocks.createRecord).toHaveBeenCalledWith("cfp_submissions", {
      ...input,
      applicant: applicantId,
    });
  });
});

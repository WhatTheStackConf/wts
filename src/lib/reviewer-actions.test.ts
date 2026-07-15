import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const requireReviewer = vi.fn();
  const requireReviewerSession = vi.fn();
  const fetchAllRecords = vi.fn();
  const fetchRecordById = vi.fn();
  const createRecord = vi.fn();
  const updateRecord = vi.fn();
  const reviewerCreate = vi.fn();
  const reviewerUpdate = vi.fn();
  const collection = vi.fn();
  return {
    requireReviewer,
    requireReviewerSession,
    fetchAllRecords,
    fetchRecordById,
    createRecord,
    updateRecord,
    reviewerCreate,
    reviewerUpdate,
    collection,
    adminService: { fetchAllRecords, fetchRecordById, createRecord, updateRecord },
    reviewerPb: { collection },
  };
});

vi.mock("~/lib/server-auth", () => ({
  requireReviewer: mocks.requireReviewer,
  requireReviewerSession: mocks.requireReviewerSession,
}));
vi.mock("~/lib/pocketbase-admin-service", () => ({ getAdminPB: () => mocks.adminService }));
vi.mock("@solidjs/start/server", () => ({ createServerReference: (fn: unknown) => fn }));

import {
  fetchReviewerSubmissionDetailCore as fetchReviewerSubmissionDetail,
  fetchReviewerSubmissionsCore as fetchReviewerSubmissions,
  fetchWeightVotesCore as fetchWeightVotes,
  saveWeightVoteCore as saveWeightVote,
  submitReviewCore as submitReview,
} from "~/lib/reviewer-actions-core";

const reviewer = { id: "reviewer-user-a", role: "reviewer" };
const admin = { id: "admin-user-0001", role: "admin" };
const submissionId = "aaaaaaaaaaaaaaa";
const reviewId = "rrrrrrrrrrrrrrr";
const voteId = "vvvvvvvvvvvvvvv";
const weights = {
  relevance: 1,
  originality: 2,
  depth: 3,
  clarity: 4,
  takeaways: 5,
  engagement: 6,
};
const review = {
  submission: submissionId,
  score_relevance: 1,
  score_originality: 2,
  score_depth: 3,
  score_clarity: 4,
  score_takeaways: 5,
  score_engagement: 5,
  notes: "Private notes",
  is_llm_suspected: false,
};

describe("reviewer server policy", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const mock of [
      mocks.requireReviewer,
      mocks.requireReviewerSession,
      mocks.fetchAllRecords,
      mocks.fetchRecordById,
      mocks.createRecord,
      mocks.updateRecord,
      mocks.reviewerCreate,
      mocks.reviewerUpdate,
      mocks.collection,
    ]) mock.mockReset();
    mocks.requireReviewer.mockResolvedValue(reviewer);
    mocks.requireReviewerSession.mockResolvedValue({ user: reviewer, pb: mocks.reviewerPb });
    mocks.collection.mockReturnValue({
      create: mocks.reviewerCreate,
      update: mocks.reviewerUpdate,
    });
  });

  it("rejects unauthenticated and wrong-role calls before privileged data access", async () => {
    mocks.requireReviewer.mockRejectedValue(new Error("Unauthorized"));
    await expect(fetchReviewerSubmissions()).resolves.toEqual({ success: false, error: "Unauthorized" });
    expect(mocks.fetchAllRecords).not.toHaveBeenCalled();

    mocks.requireReviewer.mockResolvedValue(admin);
    await expect(saveWeightVote(null, weights)).resolves.toEqual({ success: false, error: "Unauthorized" });
    expect(mocks.createRecord).not.toHaveBeenCalled();
    expect(mocks.reviewerCreate).not.toHaveBeenCalled();
  });

  it("returns only the minimized reviewer queue DTO", async () => {
    mocks.fetchAllRecords
      .mockResolvedValueOnce([{
        id: submissionId,
        session_title: "A safe title",
        applicant: "private-applicant",
        notes: "organizer-only",
        meta: { email: "not-returned@example.test" },
      }])
      .mockResolvedValueOnce([]);
    const result = await fetchReviewerSubmissions();
    expect(result).toEqual({
      success: true,
      data: {
        reviewed: [],
        unreviewed: [{ id: submissionId, session_title: "A safe title" }],
        totalLeft: 1,
      },
    });
  });

  it("returns minimized submission detail and only the caller's review", async () => {
    mocks.fetchRecordById.mockResolvedValue({
      id: submissionId,
      session_title: "A safe title",
      abstract: "Abstract",
      key_takeaways: "Takeaways",
      technical_requirements: "Projector",
      applicant: "private-applicant",
      notes: "organizer-only",
      meta: { contact: "not-returned@example.test" },
    });
    mocks.fetchAllRecords.mockResolvedValue([{ id: reviewId, reviewer: reviewer.id, ...review }]);
    const result = await fetchReviewerSubmissionDetail(submissionId);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.submission).toEqual({
      id: submissionId,
      session_title: "A safe title",
      abstract: "Abstract",
      key_takeaways: "Takeaways",
      technical_requirements: "Projector",
    });
    expect(result.data.reviews).toEqual([{
      id: reviewId,
      score_relevance: 1,
      score_originality: 2,
      score_depth: 3,
      score_clarity: 4,
      score_takeaways: 5,
      score_engagement: 5,
      notes: "Private notes",
      is_llm_suspected: false,
    }]);
    expect(mocks.fetchAllRecords).toHaveBeenCalledWith("cfp_reviews", expect.objectContaining({
      filter: expect.stringContaining(`reviewer = "${reviewer.id}"`),
    }));
  });

  it("rejects finalized submission detail for reviewers", async () => {
    mocks.fetchRecordById.mockResolvedValue({ id: submissionId, status: "accepted" });
    await expect(fetchReviewerSubmissionDetail(submissionId)).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    });
    expect(mocks.fetchAllRecords).not.toHaveBeenCalled();
  });

  it("returns only the reviewer's vote without exposing aggregate peer data", async () => {
    mocks.fetchAllRecords.mockResolvedValue([{ id: voteId, ...weights }]);
    const result = await fetchWeightVotes();
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toEqual([{ id: voteId, ...weights }]);
    expect(result.averages).toEqual({});
    expect(result.voteCount).toBe(0);
    expect(mocks.fetchAllRecords).toHaveBeenCalledWith("cfp_weight_votes", {
      filter: `user = "${reviewer.id}"`,
      fields: "id,relevance,originality,depth,clarity,takeaways,engagement",
    });
  });

  it("returns aggregate weight results only to admins", async () => {
    mocks.requireReviewer.mockResolvedValue(admin);
    mocks.fetchAllRecords.mockResolvedValue([
      { id: voteId, user: reviewer.id, ...weights },
      { id: "wwwwwwwwwwwwwww", user: "reviewer-user-b", ...weights, relevance: 5 },
    ]);
    const result = await fetchWeightVotes();
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toEqual([]);
    expect((result.averages as Record<string, number>).relevance).toBe(3);
    expect(result.voteCount).toBe(2);
  });

  it("rejects forged vote ownership and unknown fields", async () => {
    await expect(saveWeightVote(null, { ...weights, user: "reviewer-user-b" })).resolves.toEqual({
      success: false,
      error: "Could not save the weight vote.",
    });
    expect(mocks.createRecord).not.toHaveBeenCalled();
  });

  it("sets vote ownership after validation", async () => {
    mocks.fetchAllRecords.mockResolvedValue([]);
    mocks.createRecord.mockResolvedValue({ id: voteId, user: reviewer.id, ...weights });
    const result = await saveWeightVote(null, weights);
    expect(result).toEqual({ success: true, data: { id: voteId, ...weights } });
    expect(mocks.createRecord).toHaveBeenCalledWith("cfp_weight_votes", {
      ...weights,
      user: reviewer.id,
    });
  });

  it("rejects forged review ownership and preserves submission ownership on update", async () => {
    await expect(submitReview({ ...review, reviewer: "reviewer-user-b" })).resolves.toEqual({
      success: false,
      error: "Could not save the review.",
    });
    expect(mocks.createRecord).not.toHaveBeenCalled();

    mocks.fetchRecordById.mockResolvedValue({
      id: reviewId,
      reviewer: reviewer.id,
      submission: "bbbbbbbbbbbbbbb",
    });
    await expect(submitReview({ id: reviewId, ...review })).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    });
    expect(mocks.updateRecord).not.toHaveBeenCalled();
    expect(mocks.reviewerUpdate).not.toHaveBeenCalled();
  });

  it("relies on reviewer PocketBase rules for atomic submission eligibility", async () => {
    mocks.fetchAllRecords.mockResolvedValue([]);
    mocks.reviewerCreate.mockRejectedValue(new Error("PocketBase rule rejected the write"));
    await expect(submitReview(review)).resolves.toEqual({
      success: false,
      error: "Could not save the review.",
    });
    expect(mocks.collection).toHaveBeenCalledWith("cfp_reviews");
    expect(mocks.reviewerCreate).toHaveBeenCalledOnce();
  });
});

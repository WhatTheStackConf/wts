import { requireReviewer, requireReviewerSession } from "~/lib/server-auth";
import { getAdminPB } from "~/lib/pocketbase-admin-service";

const WEIGHT_CRITERIA = [
  "relevance",
  "originality",
  "depth",
  "clarity",
  "takeaways",
  "engagement",
] as const;

const REVIEW_CRITERIA = [
  "score_relevance",
  "score_originality",
  "score_depth",
  "score_clarity",
  "score_takeaways",
  "score_engagement",
] as const;

const VALID_ID = /^[a-zA-Z0-9]{15}$/;

export interface ReviewerSubmissionListDto {
  id: string;
  session_title: string;
}

export interface ReviewerSubmissionDetailDto extends ReviewerSubmissionListDto {
  abstract: string;
  key_takeaways: string;
  technical_requirements: string;
}

export interface ReviewerReviewDto {
  id: string;
  score_relevance: number;
  score_originality: number;
  score_depth: number;
  score_clarity: number;
  score_takeaways: number;
  score_engagement: number;
  notes: string;
  is_llm_suspected: boolean;
}

export interface ReviewerWeightVoteDto {
  id: string;
  relevance: number;
  originality: number;
  depth: number;
  clarity: number;
  takeaways: number;
  engagement: number;
}

export type ReviewerLeaderboardRow = {
  reviewerId: string;
  reviewerName: string;
  reviewCount: number;
};

function validateRecordId(id: string): string {
  if (!VALID_ID.test(id)) throw new Error("Invalid record ID");
  return id;
}

function failure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  console.error(JSON.stringify({
    event: "reviewer_action_failed",
    errorType: error instanceof Error ? error.name : "UnknownError",
  }));
  return { success: false as const, error: message === "Unauthorized" ? "Unauthorized" : fallback };
}

function submissionListDto(record: any): ReviewerSubmissionListDto {
  return { id: String(record.id), session_title: String(record.session_title || "") };
}

function submissionDetailDto(record: any): ReviewerSubmissionDetailDto {
  return {
    ...submissionListDto(record),
    abstract: String(record.abstract || ""),
    key_takeaways: String(record.key_takeaways || ""),
    technical_requirements: String(record.technical_requirements || ""),
  };
}

function reviewDto(record: any): ReviewerReviewDto {
  return {
    id: String(record.id),
    score_relevance: Number(record.score_relevance),
    score_originality: Number(record.score_originality),
    score_depth: Number(record.score_depth),
    score_clarity: Number(record.score_clarity),
    score_takeaways: Number(record.score_takeaways),
    score_engagement: Number(record.score_engagement),
    notes: String(record.notes || ""),
    is_llm_suspected: record.is_llm_suspected === true,
  };
}

function isPendingSubmission(record: any): boolean {
  return !record.status || record.status === "pending";
}

function weightVoteDto(record: any): ReviewerWeightVoteDto {
  return {
    id: String(record.id),
    relevance: Number(record.relevance),
    originality: Number(record.originality),
    depth: Number(record.depth),
    clarity: Number(record.clarity),
    takeaways: Number(record.takeaways),
    engagement: Number(record.engagement),
  };
}

function calculateWeightAverages(votes: any[]): Record<string, number> {
  const averages: Record<string, number> = {};
  for (const criterion of WEIGHT_CRITERIA) {
    const values = votes
      .map((vote) => Number(vote[criterion]))
      .filter((value) => Number.isFinite(value) && value > 0);
    const sum = values.reduce((acc, value) => acc + value, 0);
    averages[criterion] = values.length > 0 ? sum / values.length : 1;
  }
  return averages;
}

function validatedWeights(input: unknown): Record<(typeof WEIGHT_CRITERIA)[number], number> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid weight vote.");
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !WEIGHT_CRITERIA.includes(key as any))) {
    throw new Error("Invalid weight vote.");
  }
  return Object.fromEntries(
    WEIGHT_CRITERIA.map((criterion) => {
      const value = record[criterion];
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 6) {
        throw new Error("Invalid weight vote.");
      }
      return [criterion, Number(value)];
    }),
  ) as Record<(typeof WEIGHT_CRITERIA)[number], number>;
}

function validatedReview(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid review.");
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set<string>([
    "id",
    "submission",
    "notes",
    "is_llm_suspected",
    ...REVIEW_CRITERIA,
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error("Invalid review.");
  }
  const submission = validateRecordId(String(record.submission || ""));
  const id = record.id ? validateRecordId(String(record.id)) : undefined;
  const notes = String(record.notes || "");
  if (notes.length > 10_000 || typeof record.is_llm_suspected !== "boolean") {
    throw new Error("Invalid review.");
  }
  const scores = Object.fromEntries(
    REVIEW_CRITERIA.map((criterion) => {
      const value = record[criterion];
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) {
        throw new Error("Invalid review.");
      }
      return [criterion, Number(value)];
    }),
  );
  return { id, submission, notes, is_llm_suspected: record.is_llm_suspected, ...scores };
}

/**
 * Policy: eligible CFP Submissions remain visible to reviewers for random
 * selection, but list responses contain only the fields used by that queue.
 */
export const fetchReviewerSubmissionsCore = async () => {
  try {
    const user = await requireReviewer();
    const adminService = getAdminPB();
    const [submissions, myReviews] = await Promise.all([
      adminService.fetchAllRecords("cfp_submissions", {
        filter: 'status = "pending" || status = ""',
        fields: "id,session_title",
      }),
      adminService.fetchAllRecords("cfp_reviews", {
        filter: `reviewer = "${user.id}"`,
        fields: "submission",
      }),
    ]);
    const reviewedIds = new Set(myReviews.map((review: any) => review.submission));
    const reviewed = submissions.filter((submission: any) => reviewedIds.has(submission.id));
    const unreviewed = submissions.filter((submission: any) => !reviewedIds.has(submission.id));
    return {
      success: true as const,
      data: {
        reviewed: reviewed.map(submissionListDto),
        unreviewed: unreviewed.map(submissionListDto),
        totalLeft: unreviewed.length,
      },
    };
  } catch (error) {
    return failure(error, "Could not load reviewer submissions.");
  }
};

export const fetchReviewerSubmissionDetailCore = async (id: string) => {
  try {
    const user = await requireReviewer();
    const safeId = validateRecordId(id);
    const adminService = getAdminPB();
    const isAdmin = user.role === "admin";
    const submission = await adminService.fetchRecordById("cfp_submissions", safeId, {
      expand: isAdmin ? "applicant.user" : undefined,
      fields: isAdmin
        ? undefined
        : "id,session_title,abstract,key_takeaways,technical_requirements,status",
    });
    if (!isAdmin && !isPendingSubmission(submission)) throw new Error("Unauthorized");
    const reviews = await adminService.fetchAllRecords("cfp_reviews", {
      filter: isAdmin
        ? `submission = "${safeId}"`
        : `submission = "${safeId}" && reviewer = "${user.id}"`,
      expand: isAdmin ? "reviewer" : undefined,
    });
    return {
      success: true as const,
      data: {
        submission: isAdmin ? submission : submissionDetailDto(submission),
        reviews: isAdmin ? reviews : reviews.map(reviewDto),
        userRole: user.role,
        userId: user.id,
      },
    };
  } catch (error) {
    return failure(error, "Could not load the reviewer submission.");
  }
};

/** Reviewers receive only their own vote; admins receive aggregate results only. */
export const fetchWeightVotesCore = async () => {
  try {
    const user = await requireReviewer();
    const adminService = getAdminPB();
    if (user.role === "reviewer") {
      const ownRecords = await adminService.fetchAllRecords("cfp_weight_votes", {
        filter: `user = "${user.id}"`,
        fields: `id,${WEIGHT_CRITERIA.join(",")}`,
      });
      return {
        success: true as const,
        data: ownRecords.map(weightVoteDto),
        averages: {},
        voteCount: 0,
        userRole: user.role,
      };
    }
    const allRecords = await adminService.fetchAllRecords("cfp_weight_votes", {
      fields: `id,user,${WEIGHT_CRITERIA.join(",")}`,
    });
    return {
      success: true as const,
      data: [],
      averages: calculateWeightAverages(allRecords),
      voteCount: allRecords.length,
      userRole: user.role,
    };
  } catch (error) {
    return failure(error, "Could not load weight votes.");
  }
};

export const fetchReviewerLeaderboardCore = async () => {
  try {
    await requireReviewer();
    const adminService = getAdminPB();
    const [reviewers, reviews] = await Promise.all([
      adminService.fetchAllRecords("users", {
        filter: 'role = "reviewer"',
        fields: "id,name,username",
      }),
      adminService.fetchAllRecords("cfp_reviews", { fields: "reviewer,submission" }),
    ]);
    const reviewedSubmissionsByReviewer = new Map<string, Set<string>>();
    for (const review of reviews as any[]) {
      if (!review.reviewer || !review.submission) continue;
      const reviewed = reviewedSubmissionsByReviewer.get(review.reviewer) || new Set<string>();
      reviewed.add(review.submission);
      reviewedSubmissionsByReviewer.set(review.reviewer, reviewed);
    }
    const leaderboard = (reviewers as any[])
      .map((reviewer): ReviewerLeaderboardRow => ({
        reviewerId: reviewer.id,
        reviewerName:
          reviewer.name || reviewer.username || `Reviewer ${reviewer.id.slice(-4).toUpperCase()}`,
        reviewCount: reviewedSubmissionsByReviewer.get(reviewer.id)?.size || 0,
      }))
      .sort((a, b) =>
        b.reviewCount !== a.reviewCount
          ? b.reviewCount - a.reviewCount
          : a.reviewerName.localeCompare(b.reviewerName));
    return { success: true as const, data: leaderboard };
  } catch (error) {
    return failure(error, "Could not load reviewer activity.");
  }
};

export const saveWeightVoteCore = async (voteId: string | null, input: unknown) => {
  try {
    const user = await requireReviewer();
    if (user.role !== "reviewer") throw new Error("Unauthorized");
    const votes = validatedWeights(input);
    const adminService = getAdminPB();
    const data = { ...votes, user: user.id };
    if (voteId) {
      validateRecordId(voteId);
      const existing = await adminService.fetchRecordById("cfp_weight_votes", voteId);
      if (existing.user !== user.id) throw new Error("Unauthorized");
      return {
        success: true as const,
        data: weightVoteDto(await adminService.updateRecord("cfp_weight_votes", voteId, data)),
      };
    }
    const existing = await adminService.fetchAllRecords("cfp_weight_votes", {
      filter: `user = "${user.id}"`,
      fields: "id",
    });
    if (existing.length > 0) throw new Error("A weight vote already exists.");
    return {
      success: true as const,
      data: weightVoteDto(await adminService.createRecord("cfp_weight_votes", data)),
    };
  } catch (error) {
    return failure(error, "Could not save the weight vote.");
  }
};

export const submitReviewCore = async (input: unknown) => {
  try {
    const { pb, user } = await requireReviewerSession();
    if (user.role !== "reviewer") throw new Error("Unauthorized");
    const review = validatedReview(input);
    const adminService = getAdminPB();
    const reviews = pb.collection("cfp_reviews");
    if (review.id) {
      const existing = await adminService.fetchRecordById("cfp_reviews", review.id);
      if (existing.reviewer !== user.id || existing.submission !== review.submission) {
        throw new Error("Unauthorized");
      }
      const data = { ...review, id: undefined, submission: existing.submission, reviewer: user.id };
      return {
        success: true as const,
        data: reviewDto(await reviews.update(review.id, data)),
      };
    }
    const existing = await adminService.fetchAllRecords("cfp_reviews", {
      filter: `submission = "${review.submission}" && reviewer = "${user.id}"`,
      fields: "id",
    });
    if (existing.length > 0) throw new Error("A review already exists.");
    const data = { ...review, id: undefined, reviewer: user.id };
    return {
      success: true as const,
      data: reviewDto(await reviews.create(data)),
    };
  } catch (error) {
    return failure(error, "Could not save the review.");
  }
};

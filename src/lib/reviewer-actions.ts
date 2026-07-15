import {
  fetchReviewerLeaderboardCore,
  fetchReviewerSubmissionDetailCore,
  fetchReviewerSubmissionsCore,
  fetchWeightVotesCore,
  saveWeightVoteCore,
  submitReviewCore,
} from "~/lib/reviewer-actions-core";

export type {
  ReviewerLeaderboardRow,
  ReviewerReviewDto,
  ReviewerSubmissionDetailDto,
  ReviewerSubmissionListDto,
  ReviewerWeightVoteDto,
} from "~/lib/reviewer-actions-core";

export const fetchReviewerSubmissions = async () => {
  "use server";
  return fetchReviewerSubmissionsCore();
};

export const fetchReviewerSubmissionDetail = async (id: string) => {
  "use server";
  return fetchReviewerSubmissionDetailCore(id);
};

export const fetchWeightVotes = async () => {
  "use server";
  return fetchWeightVotesCore();
};

export const fetchReviewerLeaderboard = async () => {
  "use server";
  return fetchReviewerLeaderboardCore();
};

export const saveWeightVote = async (voteId: string | null, input: unknown) => {
  "use server";
  return saveWeightVoteCore(voteId, input);
};

export const submitReview = async (input: unknown) => {
  "use server";
  return submitReviewCore(input);
};

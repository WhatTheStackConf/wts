import type { ReviewerQueueItem } from "~/lib/staff-model";

export const REVIEW_STATE_LABELS: Record<ReviewerQueueItem["reviewState"], string> = {
  unreviewed: "Not reviewed",
  stale: "Changed since your review",
  current: "Reviewed",
};

import type { ReviewerQueueItem } from "~/lib/staff-model";

export const REVIEW_STATE_LABELS: Record<ReviewerQueueItem["reviewState"], string> = {
  unreviewed: "Unreviewed",
  stale: "Stale review",
  current: "Current review",
};

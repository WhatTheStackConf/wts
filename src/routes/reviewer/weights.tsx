import { clientOnly } from "@solidjs/web";

const ReviewerWeightsPage = clientOnly(
    () => import("~/components/reviewer/ReviewerWeightsPage"),
);

export default ReviewerWeightsPage;

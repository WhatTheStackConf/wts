import { clientOnly } from "@solidjs/start";

const ReviewerWeightsPage = clientOnly(
    () => import("~/components/reviewer/ReviewerWeightsPage"),
);

export default ReviewerWeightsPage;

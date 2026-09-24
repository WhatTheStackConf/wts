import { handleFeedbackResults } from "~/lib/feedback-results-http";
export function POST(event: { request: Request }) { return handleFeedbackResults(event.request); }
export const GET = POST;
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
export const OPTIONS = POST;
export const HEAD = POST;

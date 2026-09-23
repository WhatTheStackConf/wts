import { handleFeedbackRequest } from "~/lib/feedback-http";

// Not a server function: tokens live in POST JSON, never route/query parameters.
export function POST(event: { request: Request }) {
  return handleFeedbackRequest(event.request);
}
// Explicit method rejection also carries privacy headers.
export const GET = POST;
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
export const OPTIONS = POST;
export const HEAD = POST;

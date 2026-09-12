import { handleLiveQaRequest } from "~/lib/live-qa-http";

export async function POST(event: { request: Request }) {
  return handleLiveQaRequest(event.request);
}

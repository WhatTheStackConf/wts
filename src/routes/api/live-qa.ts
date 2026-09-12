import { handleLiveQaProgramme, handleLiveQaRequest } from "~/lib/live-qa-http";

export async function GET(event: { request: Request }) {
  return handleLiveQaProgramme(event.request);
}

export async function POST(event: { request: Request }) {
  return handleLiveQaRequest(event.request);
}

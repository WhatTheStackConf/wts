import { publicConferenceGuide } from "~/lib/conference-guide-data";
import {
  handlePublicMcpRequest,
  type PublicMcpRequestEvent,
} from "~/lib/mcp-public-http";

export async function GET(event: PublicMcpRequestEvent) {
  return handlePublicMcpRequest(event, publicConferenceGuide);
}

export async function POST(event: PublicMcpRequestEvent) {
  return handlePublicMcpRequest(event, publicConferenceGuide);
}

export async function DELETE(event: PublicMcpRequestEvent) {
  return handlePublicMcpRequest(event, publicConferenceGuide);
}

export async function OPTIONS(event: PublicMcpRequestEvent) {
  return handlePublicMcpRequest(event, publicConferenceGuide);
}

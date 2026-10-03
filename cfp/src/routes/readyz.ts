import { getCfpStatus } from "~/server/applicants";

export async function GET() {
  try {
    getCfpStatus();
    return Response.json({ ready: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ready: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

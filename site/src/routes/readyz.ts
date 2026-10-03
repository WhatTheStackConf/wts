import { readPublished } from "~/server/public-content";

export async function GET() {
  try {
    readPublished(process.env.SITE_EDITION_ID ?? "2027");
    return Response.json({ ready: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ready: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

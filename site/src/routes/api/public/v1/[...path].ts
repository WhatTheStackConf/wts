import { readPublished } from "~/server/public-content";
import { createPublicApi, type PublicApiEvent } from "~/lib/public-api";

const publicApi = createPublicApi({
  loadProgramme: async () => readPublished(process.env.SITE_EDITION_ID || "2027"),
  // Only enable behind a proxy that overwrites X-Forwarded-For and blocks direct access.
  trustProxy: process.env.WTS_PUBLIC_API_TRUST_PROXY === "true",
});

export function GET(event: PublicApiEvent) { return publicApi(event); }
export function HEAD(event: PublicApiEvent) { return publicApi(event); }
export function OPTIONS(event: PublicApiEvent) { return publicApi(event); }
export function POST(event: PublicApiEvent) { return publicApi(event); }
export function PUT(event: PublicApiEvent) { return publicApi(event); }
export function PATCH(event: PublicApiEvent) { return publicApi(event); }
export function DELETE(event: PublicApiEvent) { return publicApi(event); }

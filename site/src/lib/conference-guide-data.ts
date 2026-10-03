import { createConferenceGuide } from "~/lib/conference-guide";
import { getSiteOrigin } from "~/lib/site-url";
import { readPublished } from "~/server/public-content";

export const publicConferenceGuide = createConferenceGuide({
  loadPublishedData: async () => readPublished(process.env.SITE_EDITION_ID || "2027"),
  canonicalOrigin: getSiteOrigin(),
});

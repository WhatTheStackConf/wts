import { createConferenceGuide } from "~/lib/conference-guide";
import { fetchPublicConferenceGuideProgramme } from "~/lib/conference-public";
import { fetchPublicPartnerGroups } from "~/lib/partners-public";
import { getSiteOrigin } from "~/lib/site-url";

async function loadPublishedData() {
  const [programme, partnerGroups] = await Promise.all([
    fetchPublicConferenceGuideProgramme(),
    fetchPublicPartnerGroups(),
  ]);
  return { ...programme, partnerGroups };
}

export const publicConferenceGuide = createConferenceGuide({
  loadPublishedData,
  canonicalOrigin: getSiteOrigin(),
});

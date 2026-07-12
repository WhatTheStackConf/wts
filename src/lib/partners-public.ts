import { getAdminPB } from "~/lib/pocketbase-admin-service";
import {
  buildPublicPartnerGroups,
  type PublicPartnerGroup,
} from "~/lib/partners-public-data";
import type { PartnerRecord } from "~/lib/pocketbase-types";

export type {
  PublicPartner,
  PublicPartnerGroup,
  PublicPartnerGroupKind,
  PublicPartnerTier,
  PublicPartnerType,
} from "~/lib/partners-public-data";

export const fetchPublicPartnerGroups = async (): Promise<PublicPartnerGroup[]> => {
  "use server";
  const rows = (await getAdminPB().fetchAllRecords("partners", {
    filter: `published = true`,
  })) as PartnerRecord[];

  return buildPublicPartnerGroups(rows);
};

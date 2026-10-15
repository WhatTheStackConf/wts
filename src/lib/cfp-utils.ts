import { capabilityAvailableForClient } from "~/lib/capability-availability";

export interface CfpConfig {
  cfp_open: boolean;
}

export const fetchCfpConfig = async (): Promise<CfpConfig> => {
  try {
    return { cfp_open: await capabilityAvailableForClient("cfp") };
  } catch {
    return { cfp_open: false };
  }
};

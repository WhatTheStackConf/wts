import pb from "./pocketbase";

export interface CfpConfig {
  cfp_open: boolean;
  cfp_deadline: string | null;
}

const FALLBACK_DEADLINE = "2026-07-30T23:59:59Z";

let cachedConfig: CfpConfig | null = null;

export const fetchCfpConfig = async (): Promise<CfpConfig> => {
  try {
    const record = await pb
      .collection("conference_config")
      .getFirstListItem("", { requestKey: "cfp-config" });
    cachedConfig = {
      cfp_open: record.cfp_open ?? true,
      cfp_deadline: record.cfp_deadline ?? null,
    };
  } catch {
    cachedConfig = { cfp_open: true, cfp_deadline: FALLBACK_DEADLINE };
  }
  return cachedConfig;
};

export const isCfpOpen = (): boolean => {
  if (cachedConfig) {
    if (!cachedConfig.cfp_open) return false;
    if (cachedConfig.cfp_deadline) {
      return new Date() < new Date(cachedConfig.cfp_deadline);
    }
    return true;
  }
  return new Date() < new Date(FALLBACK_DEADLINE);
};

export const getCfpDeadline = (): Date => {
  if (cachedConfig?.cfp_deadline) {
    return new Date(cachedConfig.cfp_deadline);
  }
  return new Date(FALLBACK_DEADLINE);
};

export const getTimeUntilCfpCloses = (): {
  days: number;
  hours: number;
  minutes: number;
} => {
  const deadline = getCfpDeadline();
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0 };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return { days, hours, minutes };
};

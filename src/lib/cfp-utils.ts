// CFP deadline configuration
// This could be fetched from an environment variable or a configuration in a real application
const CFP_DEADLINE = import.meta.env.CFP_DEADLINE || "2026-07-30T23:59:59Z"; // Default to March 1, 2025

// Function to check if the CFP is still open
export const isCfpOpen = (): boolean => {
  const deadline = new Date(CFP_DEADLINE);
  const now = new Date();
  return now < deadline;
};

// Function to get the CFP deadline date
export const getCfpDeadline = (): Date => {
  return new Date(CFP_DEADLINE);
};

// Function to get the time remaining until the CFP closes
export const getTimeUntilCfpCloses = (): {
  days: number;
  hours: number;
  minutes: number;
} => {
  const deadline = new Date(CFP_DEADLINE);
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0 };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return { days, hours, minutes };
};

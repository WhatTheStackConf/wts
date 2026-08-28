export const pressKitDescription =
  "WhatTheStack is a community-run software conference in Skopje. The 2026 edition runs from September 14 to 19, with smaller events and workshops through the week and a five-stage main conference on Saturday.";

export const pressKitFacts = [
  { label: "Edition", value: "WhatTheStack 2026" },
  { label: "Conference week", value: "2026-09-14 to 2026-09-19" },
  { label: "Main conference", value: "2026-09-19" },
  { label: "Location", value: "Skopje, North Macedonia" },
  { label: "Venue", value: "Technical Campus" },
  { label: "Organizers", value: "DeveD, Base42, Angular Macedonia" },
  { label: "Website", value: "https://wts.sh", href: "https://wts.sh" },
  { label: "Contact", value: "what@wts.sh", href: "mailto:what@wts.sh" },
  { label: "X", value: "https://x.com/what_the_stack", href: "https://x.com/what_the_stack" },
  { label: "Facebook", value: "https://fb.me/whatthestack", href: "https://fb.me/whatthestack" },
  { label: "Instagram", value: "https://instagram.com/what_the_stack_conference", href: "https://instagram.com/what_the_stack_conference" },
  { label: "LinkedIn", value: "https://www.linkedin.com/company/what-the-stack-conference", href: "https://www.linkedin.com/company/what-the-stack-conference" },
  { label: "Bluesky", value: "https://bsky.app/profile/wts.rocks", href: "https://bsky.app/profile/wts.rocks" },
  { label: "YouTube", value: "https://www.youtube.com/@WhatTheStackConference", href: "https://www.youtube.com/@WhatTheStackConference" },
] as const;

export const pressKitGradients = [
  { from: "#91F6FF", to: "#2EC8FE" },
  { from: "#FFC03D", to: "#FE7457" },
  { from: "#FEA403", to: "#CD3DD0" },
  { from: "#25DBFA", to: "#A240FE" },
] as const;

export const pressKitUsageGuidance = [
  {
    heading: "Allowed use",
    body: "Media may use these materials for editorial coverage. Partners may use them to promote their actual WhatTheStack 2026 involvement. No advance approval or formal credit line is required. Link to https://wts.sh where practical.",
  },
  {
    heading: "Conference name",
    body: "Use “WhatTheStack 2026” on first mention. You may use “WhatTheStack” or “WTS” afterward where the reference remains clear. Preserve the exact WhatTheStack spelling. Do not present third-party material as official conference communication.",
  },
  {
    heading: "Logo mark",
    body: "Use either supplied logo file unchanged. You may resize it proportionally and place it visibly separate from other marks. Do not stretch, crop, rotate, recolor, redraw, add effects, overlap it with artwork, create a merged lockup, or place it where the full artwork lacks readable contrast.",
  },
  {
    heading: "Logo gradients",
    body: "You may use the four exact gradients shown here as WhatTheStack 2026 promotional accents. They are logo gradients, not a complete brand palette.",
  },
  {
    heading: "Facts and copy",
    body: "You may quote the event description or adapt it lightly for length or house style without changing its meaning. Keep all listed facts accurate. Check claims not listed here with what@wts.sh.",
  },
  {
    heading: "Partner relationship",
    body: "Describe only your actual relationship to WhatTheStack 2026. Do not imply sponsorship, endorsement, or official-organizer status beyond that role.",
  },
  {
    heading: "Other uses",
    body: "For uses outside editorial coverage or promotion of an actual Partner relationship, contact what@wts.sh.",
  },
] as const;

export const pressKitAllFacts = pressKitFacts
  .map((fact) => `${fact.label}: ${fact.value}`)
  .join("\n");

export function pressKitCanonicalUrl(origin: string): string {
  return origin.replace(/\/$/, "") === "https://2026.wts.sh"
    ? "https://2026.wts.sh/press-kit"
    : "https://wts.sh/press-kit";
}

export function formatPressKitGradient(gradient: (typeof pressKitGradients)[number]): string {
  return `${gradient.from} → ${gradient.to}`;
}

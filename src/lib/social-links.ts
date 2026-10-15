interface SocialPlatform { hosts: string[]; icon: string; label: string }

const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { hosts: ["github.com"], icon: "mdi:github", label: "GitHub" },
  { hosts: ["linkedin.com"], icon: "mdi:linkedin", label: "LinkedIn" },
  { hosts: ["x.com", "twitter.com"], icon: "ri:twitter-x-fill", label: "X" },
  { hosts: ["bsky.app"], icon: "ri:bluesky-fill", label: "Bluesky" },
  { hosts: ["youtube.com", "youtu.be"], icon: "mdi:youtube", label: "YouTube" },
  { hosts: ["twitch.tv"], icon: "mdi:twitch", label: "Twitch" },
];

function findSocialPlatform(link: string): SocialPlatform | undefined {
  const l = link.toLowerCase();
  return SOCIAL_PLATFORMS.find((platform) => platform.hosts.some((host) => l.includes(host)));
}

/** Icon id for a social/profile URL (shared with CFP SmartArea). */
export function getSocialIcon(link: string): string {
  return findSocialPlatform(link)?.icon ?? "material-symbols:link";
}

/** Accessible name for a social link target. */
export function getSocialPlatformLabel(link: string): string {
  const platform = findSocialPlatform(link);
  if (platform) return platform.label;
  try {
    const host = new URL(link.startsWith("http") ? link : `https://${link}`).hostname;
    return host.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}

export function socialLinkHref(handle: string): string {
  return handle.startsWith("http") ? handle : `https://${handle}`;
}

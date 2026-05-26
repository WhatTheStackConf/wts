/** Icon id for a social/profile URL (shared with CFP SmartArea). */
export function getSocialIcon(link: string): string {
  const l = link.toLowerCase();
  if (l.includes("github.com")) return "mdi:github";
  if (l.includes("linkedin.com")) return "mdi:linkedin";
  if (l.includes("x.com") || l.includes("twitter.com")) return "ri:twitter-x-fill";
  if (l.includes("bsky.app")) return "ri:bluesky-fill";
  if (l.includes("youtube.com") || l.includes("youtu.be")) return "mdi:youtube";
  if (l.includes("twitch.tv")) return "mdi:twitch";
  return "material-symbols:link";
}

/** Accessible name for a social link target. */
export function getSocialPlatformLabel(link: string): string {
  const l = link.toLowerCase();
  if (l.includes("github.com")) return "GitHub";
  if (l.includes("linkedin.com")) return "LinkedIn";
  if (l.includes("x.com") || l.includes("twitter.com")) return "X";
  if (l.includes("bsky.app")) return "Bluesky";
  if (l.includes("youtube.com") || l.includes("youtu.be")) return "YouTube";
  if (l.includes("twitch.tv")) return "Twitch";
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

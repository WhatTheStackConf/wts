import { describe, expect, it } from "vite-plus/test";

import { getSocialIcon, getSocialPlatformLabel, socialLinkHref } from "~/lib/social-links";

const cases: Array<[link: string, icon: string, label: string]> = [
  ["https://github.com/jdoe", "mdi:github", "GitHub"],
  ["https://www.LinkedIn.com/in/jdoe", "mdi:linkedin", "LinkedIn"],
  ["https://x.com/jdoe", "ri:twitter-x-fill", "X"],
  ["twitter.com/jdoe", "ri:twitter-x-fill", "X"],
  ["https://bsky.app/profile/jdoe.bsky.social", "ri:bluesky-fill", "Bluesky"],
  ["https://www.youtube.com/@jdoe", "mdi:youtube", "YouTube"],
  ["https://youtu.be/abc", "mdi:youtube", "YouTube"],
  ["https://twitch.tv/jdoe", "mdi:twitch", "Twitch"],
  ["https://github.com/x.com", "mdi:github", "GitHub"],
  ["https://www.example.org/about", "material-symbols:link", "example.org"],
  ["jdoe.dev/blog", "material-symbols:link", "jdoe.dev"],
  ["http://", "material-symbols:link", "Website"],
];

describe("social links", () => {
  it.each(cases)("maps %s to its icon and accessible label", (link, icon, label) => {
    expect(getSocialIcon(link)).toBe(icon);
    expect(getSocialPlatformLabel(link)).toBe(label);
  });

  it("currently maps dropbox.com to X (substring match, known defect)", () => {
    expect(getSocialIcon("https://dropbox.com/jdoe")).toBe("ri:twitter-x-fill");
    expect(getSocialPlatformLabel("https://dropbox.com/jdoe")).toBe("X");
  });

  it("prefixes bare handles with https", () => {
    expect(socialLinkHref("jdoe.dev")).toBe("https://jdoe.dev");
    expect(socialLinkHref("http://jdoe.dev")).toBe("http://jdoe.dev");
  });
});

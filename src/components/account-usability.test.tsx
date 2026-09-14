import { readFileSync } from "node:fs";
import { renderToString } from "@solidjs/web";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import LoginMenu from "~/components/LoginMenu";

const auth = vi.hoisted(() => ({
  record: { name: "Account Test", email: "account@example.test", role: "user" },
  isAuthenticated: vi.fn(() => true),
  isLoading: vi.fn(() => false),
  logout: vi.fn(async () => {}),
}));

vi.mock("~/lib/auth-context", () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth.isAuthenticated.mockReturnValue(true);
  auth.isLoading.mockReturnValue(false);
  auth.record.role = "user";
});

describe("account menu", () => {
  it.each(["user", "reviewer", "admin"])("keeps account actions available to %s", (role) => {
    auth.record.role = role;
    const html = renderToString(() => <LoginMenu />);
    expect(html).toContain('aria-label="Account menu for Account"');
    expect(html).toContain('popovertarget="user-menu"');
    expect(html).toContain('href="/user/profile"');
    expect(html).toContain('href="/user/profile#gamification"');
    expect(html).toContain("Achievements");
    expect(html).toContain("Log out");
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('class="divider');
  });

  it("shows only the login action when signed out", () => {
    auth.isAuthenticated.mockReturnValue(false);
    const html = renderToString(() => <LoginMenu />);
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('id="user-menu"');
    expect(html).not.toContain("account@example.test");
  });

  it("does not flash login while authentication is loading", () => {
    auth.isAuthenticated.mockReturnValue(false);
    auth.isLoading.mockReturnValue(true);
    const html = renderToString(() => <LoginMenu />);
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('id="user-menu"');
  });
});

// These source contracts supplement the real-backend profile browser suite.
// The routes are clientOnly, so SSR cannot exercise their forms or mutations.
describe("account route presentation contracts", () => {
  const profile = readFileSync(new URL("../routes/user/profile.tsx", import.meta.url), "utf8");
  const redeem = readFileSync(new URL("../routes/missions/redeem.tsx", import.meta.url), "utf8");

  it("preserves account field targets, achievement deep links, and save handlers", () => {
    for (const id of ["profile-name", "profile-email", "ops-board-visible", "ops-board-display-name", "ops-board-public-badges", "gamification"]) {
      expect(profile).toContain(`id="${id}"`);
    }
    expect(profile).toContain("void handleSave(event)");
    expect(profile).toContain("void saveGamificationVisibility(event)");
    expect(profile).toContain("void saveBadgeVisibility(badge.id, event.currentTarget.checked)");
    expect(profile).toContain('proposal.status === "pending"');
    expect(profile).toContain("handleEditProposal(proposal)");
  });

  it("uses named disclosures without duplicating earned badges", () => {
    expect(profile).toMatch(/<summary[^>]+>Public visibility<\/summary>/);
    expect(profile).toMatch(/<summary[^>]+>Badges to earn/);
    expect(profile).not.toContain("Recent Badges");
    expect(profile).toContain('<For each={summary().badges}>');
    expect(profile).toContain("Email addresses are never used as public display names.");
    expect(profile).toContain("Your XP, badges, and access level stay unchanged.");
    expect(profile).toContain("Turning this off hides all badges, not your row.");
  });

  it("retains separate unchecked consent and handoff limits", () => {
    for (const source of [profile, redeem]) {
      expect(source).toContain('new FormData(form).get("partner-follow-up")');
      const checkbox = source.match(/<input\b[^>]*name="partner-follow-up"[^>]*\/>/)?.[0];
      expect(checkbox).toBeDefined();
      expect(checkbox).not.toMatch(/\bchecked(?:\s|=)/);
      expect(source).toContain("current name and email");
      expect(source).toContain("noticeVersion");
      expect(source).toContain("cannot undo");
    }
    expect(profile).toContain("one future handoff");
    expect(profile).toContain("Withdraw consent");
    expect(profile).toContain("claims, badges, total XP, or Leaderboard XP");
    expect(redeem).toContain("email once with");
    expect(redeem).toContain("Consent does not affect mission progress, badges, or XP.");
  });

  it("keeps code privacy and retry feedback while moving secondary help into details", () => {
    expect(redeem).toContain("Do not share a scanned code in messages or screenshots.");
    expect(redeem).toContain("Your scanned code stays only in this tab");
    expect(redeem).toMatch(/<summary[^>]+>Code help<\/summary>/);
    expect(redeem).toContain('id="mission-code-error"');
    expect(redeem).toContain('current().status === "rate_limited" || current().status === "unavailable"');
    expect(redeem).toContain('href="/user/profile#gamification"');
    expect(redeem).toContain("profile().supportReference");
    expect(redeem).not.toContain("separate partner_follow_up handoff");
  });
});
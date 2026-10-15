import type { Component, ParentProps } from "solid-js";
import { renderToString } from "@solidjs/web";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type ResourceCall = { source?: () => unknown; fetcher: (source?: unknown) => unknown };

const state = vi.hoisted(() => ({
  resources: [] as unknown[],
  calls: [] as ResourceCall[],
  auth: {
    loading: false,
    authenticated: true,
    record: { id: "user-1", name: "Ada Lovelace", email: "ada@example.test", role: "user", verified: true } as Record<string, unknown> | null,
  },
}));

vi.mock("@solidjs/web", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solidjs/web")>();
  return {
    ...actual,
    clientOnly: (load: () => Promise<{ default: Component<Record<string, unknown>> }>) => {
      let loaded: Component<Record<string, unknown>> | undefined;
      const ready = load().then((module) => { loaded = module.default; });
      return Object.assign((props: Record<string, unknown>) => loaded?.(props), { ready });
    },
  };
});
vi.mock("@solidjs/router", () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: "submission-1" }) }));
vi.mock("~/layouts/Layout", () => ({ Layout: (props: ParentProps) => <main>{props.children}</main> }));
vi.mock("~/components/PublicPageShell", () => ({ PublicPageShell: (props: ParentProps) => <main>{props.children}</main> }));
vi.mock("~/lib/async-resource", () => ({
  createAsyncResource: (sourceOrFetcher: ResourceCall["fetcher"], maybeFetcher?: ResourceCall["fetcher"]) => {
    const value = state.resources[state.calls.length];
    state.calls.push(maybeFetcher ? { source: sourceOrFetcher, fetcher: maybeFetcher } : { fetcher: sourceOrFetcher });
    return [Object.assign(() => value, { loading: false, error: undefined }), { refetch: vi.fn(), mutate: vi.fn() }];
  },
}));
vi.mock("~/lib/auth-context", () => ({
  useAuth: () => ({
    isLoading: () => state.auth.loading,
    isAuthenticated: () => state.auth.authenticated,
    get record() { return state.auth.record; },
    get user() { return state.auth.record; },
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock("~/lib/route-guards", () => ({ useRequireReviewer: () => ({ authorized: () => true }), useRequireAdmin: () => ({ authorized: () => true }) }));
vi.mock("~/components/admin/AdminPageShell", () => ({
  AdminPageShell: (props: ParentProps) => <main>{props.children}</main>,
  adminFormPanelClass: "admin-panel",
  useAdminToast: () => ({ toast: () => undefined, showToast: vi.fn() }),
}));
vi.mock("~/lib/admin-actions", () => ({ adminFetchCfpConfig: vi.fn(), adminUpdateCfpConfig: vi.fn() }));
vi.mock("~/lib/cfp-store", () => ({ fetchProposals: vi.fn(), loadSubmissionToStore: vi.fn(), resetProposalData: vi.fn() }));
vi.mock("~/lib/gamification-profile", () => ({
  getMyGamificationProfileSummary: vi.fn(),
  getPublicOpsBoard: vi.fn(),
  updateMyGamificationBadgeVisibility: vi.fn(),
  updateMyGamificationVisibility: vi.fn(),
}));
vi.mock("~/lib/partner-contact-consent-actions", () => ({
  getMyPartnerContactConsentSummaries: vi.fn(),
  grantMyPartnerContactConsent: vi.fn(),
  withdrawMyPartnerContactConsent: vi.fn(),
}));
vi.mock("~/lib/gamification-hievents-actions", () => ({ getMyHiEventsEvidenceStatus: vi.fn(), refreshMyHiEventsEvidence: vi.fn() }));
vi.mock("~/lib/profile-actions", () => ({ updateMyProfile: vi.fn() }));
vi.mock("~/lib/mission-code-redemption-action", () => ({ redeemMissionCode: vi.fn() }));

import AdminDashboardPage from "~/routes/admin/index";
import OpsBoardPage from "~/routes/ops-board";
import ProfilePage from "~/routes/user/profile";
import RedeemMissionPage from "~/routes/missions/redeem";
import ReviewPage from "~/routes/reviewer/[id]";
import { adminFetchCfpConfig } from "~/lib/admin-actions";
import { fetchProposals } from "~/lib/cfp-store";
import { getMyGamificationProfileSummary, getPublicOpsBoard } from "~/lib/gamification-profile";
import { getMyHiEventsEvidenceStatus } from "~/lib/gamification-hievents-actions";
import { getMyPartnerContactConsentSummaries } from "~/lib/partner-contact-consent-actions";
import { expectFragments, expectInOrder, links, markup } from "./route-markup-test-helper";

// Each page's createAsyncResource calls, in creation order, with the action each one fetches through.
// render() seeds a resource by name and fails when the page's resource order no longer matches.
const profileResources = {
  proposals: vi.mocked(fetchProposals),
  gamification: vi.mocked(getMyGamificationProfileSummary),
  partnerConsents: vi.mocked(getMyPartnerContactConsentSummaries),
  ticketStatus: vi.mocked(getMyHiEventsEvidenceStatus),
};
const opsBoardResources = { board: vi.mocked(getPublicOpsBoard) };
const adminResources = { cfpData: vi.mocked(adminFetchCfpConfig) };

type Action = Pick<ReturnType<typeof vi.fn>, "mock" | "mockClear">;
type Page = Component & { ready: Promise<void> };

function fetchedThrough(resources: Record<string, Action>, { source, fetcher }: ResourceCall) {
  for (const action of Object.values(resources)) action.mockClear();
  void Promise.resolve(fetcher(source?.())).catch(() => undefined);
  return Object.entries(resources).find(([, action]) => action.mock.calls.length > 0)?.[0];
}

async function render<Resources extends Record<string, Action>>(
  page: unknown,
  resources: Resources,
  values: Partial<Record<keyof Resources, unknown>> = {},
) {
  await (page as Page).ready;
  const names = Object.keys(resources);
  state.resources = names.map((name) => values[name]);
  state.calls = [];
  const html = renderToString(() => (page as Page)({}));
  expect(state.calls.map((call) => fetchedThrough(resources, call))).toEqual(names);
  return markup(html);
}

const summary = {
  repair: { state: "rebuild_pending", supportReference: "SUP-1" },
  totalXp: 120,
  accessLevelLabel: "Level 2",
  leaderboardXp: 90,
  opsBoard: { visible: true, displayName: "Ada", publicBadgesVisible: true },
  progressAvailable: true,
  xpToNextLevel: 30,
  xpIntoLevel: 20,
  progressPercent: 40,
  badges: [{ id: "b1", icon: "", name: "First", description: "First badge", category: "core", rarity: "common", retired: true, publicVisible: false }],
  revokedBadgeCount: 1,
  lockedBadges: [{ name: "Locked", teaser: "Soon", category: "core", rarity: "rare" }],
  suggestedMissions: [{ title: "Mission", summary: "Do it", redemptionPath: "/missions/redeem#x" }],
};
const consents = [
  { activityId: "a1", partner: { name: "Acme" }, activityLabel: "Booth", purpose: "Hiring", noticeVersion: "v1", fields: ["name", "email"], state: "available" },
  { activityId: "a2", consentId: "c2", partner: { name: "Beta" }, activityLabel: "Talk", purpose: "News", noticeVersion: "v2", fields: ["email"], state: "granted", grantedAt: "", handoffState: "handed_off" },
  { activityId: "a3", partner: { name: "Gamma" }, activityLabel: "Demo", purpose: "Demo", noticeVersion: "v3", fields: ["name"], state: "withdrawn", withdrawnAt: "" },
];
const ticket = { message: "Ticket verified", lastSuccessfulSyncAt: undefined };

beforeEach(() => {
  state.auth = {
    loading: false,
    authenticated: true,
    record: { id: "user-1", name: "Ada Lovelace", email: "ada@example.test", role: "user", verified: true },
  };
});

const profileSections = [
  '<section id="profile-settings" aria-labelledby="profile-settings-heading"><h2 id="profile-settings-heading">Account</h2>',
  '<section id="gamification" aria-labelledby="gamification-heading"><header><h2 id="gamification-heading">Achievements</h2><a href="/missions/redeem">Redeem code</a></header>',
  '<section id="proposals" aria-labelledby="proposals-heading"><div><div><h2 id="proposals-heading">Talk proposals</h2><button><svg/>Submit talk</button></div><div><p>No talk proposals yet.</p></div>',
];
const profileHeader = [
  "<h1>Profile</h1>",
  '<nav aria-label="Profile sections"><a href="#profile-settings">Account</a><a href="#gamification">Achievements</a><a href="#proposals">Talk proposals</a></nav>',
  "<button><svg/>Log out</button>",
  '<label for="profile-name"><span>Full name</span></label>',
  '<label for="profile-email"><span>Email address</span></label>',
  '<p id="profile-email-help">Contact event support to change your email address.</p>',
  '<button type="submit"><span>Save changes</span></button>',
];
const followUpForm = (activityId: string, partner: string) =>
  `<form aria-busy="false"><fieldset><label for="profile-partner-follow-up-${activityId}"><input id="profile-partner-follow-up-${activityId}" name="partner-follow-up" type="checkbox"><span>I agree that WhatTheStack may make one future handoff of my current name and email to ${partner} for follow-up about this Activity.</span></label><button type="submit">Allow follow-up</button></fieldset></form>`;
const opsBoardHeader = [
  "<header><div><p>Public field progress</p><h1>OPS BOARD</h1>"
    + "<p>Ranks use Leaderboard XP only. Agents can opt out or hide Badge snippets from their profile at any time.</p>"
    + "<p>Equal Leaderboard XP totals share the same rank. No private activity, total XP, time, or Badge count breaks a tie.</p>"
    + '</div><button type="button">Refresh board</button></header>',
];
const redeemIntro = '<section aria-labelledby="mission-redeem-heading"><h1 id="mission-redeem-heading">Redeem code</h1><p>Mission progress is saved to your signed-in profile.</p>';
const redeemForm = [
  redeemIntro,
  '<form aria-busy="false"><div><label for="mission-code"><span>Mission code</span></label>'
    + '<input id="mission-code" name="mission-code" type="text" value="" placeholder="WTS26-XXXXXXXX-XXXXXXXX" autocomplete="off" autocapitalize="characters" aria-describedby="mission-code-help">'
    + '<p id="mission-code-help">Codes are case-insensitive. Do not share a scanned code in messages or screenshots.</p></div><button type="submit">Redeem code</button></form>',
  "<details><summary>Code help</summary><p>Scan a WTS mission link or enter its code. For help, contact event support with your signed-in profile. Support will not ask you to share a code online.</p></details>",
];
const adminWorkspaces = {
  Programme: ["/admin/agenda Agenda", "/admin/sessions Sessions", "/admin/speakers Speakers", "/admin/partners Sponsors &amp; partners"],
  "CFP review": ["/admin/proposals Proposal rankings", "/reviewer/weights Scoring weights", "/reviewer/leaderboard Reviewer progress"],
  "Event operations": ["/admin/checkin Check-in stations", "/admin/tickets Tickets", "/admin/gamification Gamification", "/mc MC · live Q&amp;A"],
  Access: ["/admin/users Users &amp; roles", "/admin/mcp MCP tokens"],
};
const adminWorkspaceOrder = Object.entries(adminWorkspaces)
  .flatMap(([group, groupLinks]) => [`<h2>${group}</h2>`, ...groupLinks.map((link) => `<a href="${link.split(" ")[0]}">`)]);
const cfpSettings = [
  '<section aria-labelledby="cfp-settings-title"><div><div><h2 id="cfp-settings-title">Call for papers</h2>'
    + "<p>Saving this configuration keeps participant and reviewer workflows unavailable.</p>",
  '<label for="cfp-deadline">Preparation deadline</label>',
  '<button type="button">Save closed configuration</button>',
];

describe("route page markup", () => {
  it("renders the profile account card, achievements and proposals", async () => {
    const html = await render(ProfilePage, profileResources, { proposals: [], gamification: summary, partnerConsents: consents, ticketStatus: ticket });
    expectInOrder(html, profileSections);
    expectFragments(html, [
      ...profileHeader,
      '<img src="https://www.gravatar.com/avatar/28ae5bf8fa0cde12855e61ac303859cc?s=200&amp;d=404" alt="Ada Lovelace profile avatar">',
      "<p>Ada Lovelace</p><p>ada@example.test</p>",
      '<input id="profile-name" type="text" name="name" autocomplete="name" value="Ada Lovelace" placeholder="Enter your name">',
      '<input id="profile-email" type="email" value="ada@example.test" aria-describedby="profile-email-help" disabled>',
      '<p role="status">Your progress is saved, but totals need repair. Contact event support with reference <span>SUP-1</span>.</p>',
      '<div aria-live="polite"><div><div><p>Conference ticket status</p><p>Ticket verified</p></div><button type="button">Refresh status</button></div></div>',
      "<p>Total XP</p><p>120</p>",
      "<p>Access level</p><p>Level 2</p>",
      '<summary id="ops-board-visibility-heading">Public visibility</summary>',
      "<p>The public ops board ranks Leaderboard XP, not total XP. Opt out to keep your profile and progress private.</p></div>"
        + '<a href="/ops-board">View ops board</a></div><form aria-busy="false"><fieldset><legend>Public ops-board settings</legend>',
      '<label for="ops-board-visible"><input id="ops-board-visible" type="checkbox" checked><span><strong>Show me on the public ops board</strong>'
        + "<br>Turning this off hides your row and rank. Your XP, badges, and access level stay unchanged.</span></label>",
      '<label for="ops-board-display-name"><span>Public display name</span></label>'
        + '<input id="ops-board-display-name" type="text" value="" maxlength="80" autocomplete="off" aria-describedby="ops-board-display-name-help">'
        + '<p id="ops-board-display-name-help">Use up to 80 characters. Email addresses are never used as public display names.</p>',
      '<label for="ops-board-public-badges"><input id="ops-board-public-badges" type="checkbox" checked><span><strong>Show my badges on the ops board</strong>'
        + "<br>Turning this off hides all badges, not your row.</span></label>",
      '<p>Current Leaderboard XP: 90</p><button type="submit">Save visibility</button>',
      "<h3>Progress to next level</h3><p>20 XP in this level. 30 XP to go.</p>",
      '<progress value="40" max="100" aria-label="Progress to next access level" aria-valuetext="40% progress to the next access level"></progress><p>40% complete</p>',
      "<h3>Your badges</h3><span>1 collected</span></div><p>Badge choices apply when your ops-board row and badges are public.</p>"
        + '<ul role="list"><li><div><svg/><div><p>First</p><p>First badge</p><p>core / common / unlocked / retired</p>'
        + '<label for="badge-public-b1"><input id="badge-public-b1" type="checkbox"><span>Show on the public ops board</span></label></div></div></li></ul>',
      "<p>1 Badge removed by event support. Removed Badges do not affect your public profile.</p>",
      '<summary id="locked-badges-heading">Badges to earn (1)</summary><ul role="list"><li><p>Locked</p><p>Soon</p><p>core / rare / locked</p></li></ul>',
      '<section aria-labelledby="suggested-missions-heading"><h3 id="suggested-missions-heading">Suggested missions</h3>'
        + '<ul role="list"><li><p>Mission</p><p>Do it</p><a href="/missions/redeem#x">Redeem code</a></li></ul></section>',
      '<section aria-labelledby="partner-follow-up-heading"><h3 id="partner-follow-up-heading">Partner follow-up</h3>'
        + "<p>Optional. Consent never changes your claims, badges, total XP, or Leaderboard XP. Withdrawal blocks future WTS handoffs; it cannot undo details already shared.</p>",
    ], ["Achievements are unavailable"]);
    expectInOrder(html, [
      `<li><p>Acme</p><p>Activity: Booth</p><p>Purpose: Hiring. Notice: v1. Fields: name and email.</p>${followUpForm("a1", "Acme")}</li>`,
      "<li><p>Beta</p><p>Activity: Talk</p><p>Purpose: News. Notice: v2. Fields: email.</p>"
        + '<div><p>Consent granted . A one-time WTS handoff was already logged.</p><button type="button">Withdraw consent</button></div></li>',
      `<li><p>Gamma</p><p>Activity: Demo</p><p>Purpose: Demo. Notice: v3. Fields: name.</p>${followUpForm("a3", "Gamma")}`
        + "<p>Withdrawn . Future WTS handoffs are blocked; Mission progress is unchanged.</p></li>",
    ]);
    expect(html.match(/<button type="submit">Allow follow-up<\/button>/g)).toHaveLength(2);
  });

  it("renders the profile fallbacks without a name, email or proposals", async () => {
    state.auth.record = null;
    const html = await render(ProfilePage, profileResources, { proposals: [], partnerConsents: [] });
    expectInOrder(html, profileSections);
    expectFragments(html, [
      ...profileHeader,
      '<img src="https://www.gravatar.com/avatar/d41d8cd98f00b204e9800998ecf8427e?s=200&amp;d=404" alt="Your profile avatar">',
      "<p>Your account</p><p></p>",
      '<input id="profile-name" type="text" name="name" autocomplete="name" value="" placeholder="Enter your name">',
      '<input id="profile-email" type="email" value="" aria-describedby="profile-email-help" disabled>',
      '<p role="status">Achievements are unavailable. Refresh your profile to try again.</p>',
    ], ["Total XP", "Partner follow-up", "Conference ticket status"]);
  });

  it("renders a populated ops board page", async () => {
    const board = { page: 2, totalPages: 3, items: [{ rank: 1, displayName: "Ada", accessLevel: 2, leaderboardXp: 90, publicBadgeCount: 1, badges: [{ name: "First" }] }] };
    expectFragments(await render(OpsBoardPage, opsBoardResources, { board }), [
      ...opsBoardHeader,
      '<section aria-labelledby="ops-board-results-heading" aria-busy="false"><h2 id="ops-board-results-heading">Ops-board rankings</h2>',
      '<div role="list"><article role="listitem"><div><div><p>Rank 1</p><h3>Ada</h3><p>Access Level 2</p></div><div><p>90</p><p>Leaderboard XP</p></div></div><p>Public Badges: 1</p><ul role="list"><li>First</li></ul></article></div>',
      "<caption>Public agents ranked by Leaderboard XP</caption>",
      '<th scope="col">RANK</th><th scope="col">AGENT</th><th scope="col">ACCESS LEVEL</th><th scope="col">LEADERBOARD XP</th><th scope="col">PUBLIC BADGES</th>',
      '<tr><th scope="row">1</th><td>Ada</td><td>Access Level 2</td><td>90</td><td><p>1 public</p><ul role="list"><li>First</li></ul></td></tr>',
      '<nav aria-label="Ops-board pages"><button type="button" disabled>Previous page</button><p aria-live="polite">Page 2 of 3</p><button type="button">Next page</button></nav>',
    ], ["No public agents yet"]);
  });

  it("renders an empty ops board page", async () => {
    expectFragments(await render(OpsBoardPage, opsBoardResources), [
      ...opsBoardHeader,
      "<h2>No public agents yet</h2>",
      "<p>Public progress will appear here after agents choose to remain visible on the ops board.</p>",
    ], ["Ops-board rankings", "Ops-board pages"]);
  });

  it("renders the initial mission redemption form", async () => {
    const signedIn = await render(RedeemMissionPage, {});
    expectFragments(signedIn, [...redeemForm, `${redeemIntro}<form`, '<a href="/user/profile#gamification">View achievements</a>'], ["Log in to redeem"]);
    state.auth.authenticated = false;
    expectFragments(await render(RedeemMissionPage, {}), [
      ...redeemForm,
      `${redeemIntro}<div role="status"><p>Log in to redeem. Your scanned code stays only in this tab while you log in.</p><button type="button" disabled>Log in to redeem</button></div><form`,
    ]);
  });

  it("renders the admin CFP configuration states", async () => {
    const active = await render(AdminDashboardPage, adminResources, { cfpData: { cfp_open: false, cfp_available: true, cfp_deadline: "2027-01-31" } });
    expect(links(active, { trim: false })).toEqual(Object.values(adminWorkspaces).flat());
    expectInOrder(active, ['<nav aria-label="Admin workspaces"><section><h2>Programme</h2>', ...adminWorkspaceOrder.slice(1), "</nav>", cfpSettings[0]]);
    expectFragments(active, [
      ...cfpSettings,
      "<span>Current CFP status:</span><span>Active</span><span>Deadline: 2027-01-31</span>",
      '<input id="cfp-deadline" type="date" value="2027-01-31">',
    ]);
    expectFragments(await render(AdminDashboardPage, adminResources, { cfpData: { cfp_open: false, cfp_available: false, cfp_deadline: "" } }), [
      ...cfpSettings,
      "<span>Current CFP status:</span><span>Closed</span><span>Deadline: Not set</span>",
      '<input id="cfp-deadline" type="date" value="">',
    ]);
    expectFragments(await render(AdminDashboardPage, adminResources, { cfpData: null }), [
      ...cfpSettings,
      '<p role="status">Configuration unavailable or incomplete. Save a new closed configuration to initialize it.</p>',
      '<input id="cfp-deadline" type="date" value="">',
    ], ["Current CFP status:"]);
  });

  it("renders the reviewer page while the submission loads", async () => {
    expectFragments(await render(ReviewPage, {}), ["<button><svg/>Back to reviews</button><div><span></span></div>"], ["<h1>", "Your review"]);
  });
});

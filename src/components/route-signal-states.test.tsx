import type { Component, ParentProps } from "solid-js";
import { renderToString } from "@solidjs/web";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  seeds: new Map<number, unknown>(),
  defaults: [] as unknown[],
  role: "reviewer",
}));

vi.mock("solid-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("solid-js")>();
  return {
    ...actual,
    createSignal: (value: unknown, options?: unknown) => {
      const position = state.defaults.push(value) - 1;
      const initial = state.seeds.has(position) ? state.seeds.get(position) : value;
      return (actual.createSignal as (value: unknown, options?: unknown) => unknown)(initial, options);
    },
  };
});
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
vi.mock("~/components/MissionQuestionForm", () => ({ MissionQuestionForm: (props: { userId: string }) => <form data-user={props.userId} /> }));
vi.mock("~/lib/async-resource", () => ({
  createAsyncResource: () => [Object.assign(() => undefined, { loading: false, error: undefined }), { refetch: vi.fn() }],
}));
vi.mock("~/lib/auth-context", () => ({
  useAuth: () => ({
    isLoading: () => false,
    isAuthenticated: () => true,
    get user() { return { id: "user-1", role: state.role }; },
    record: { id: "user-1", name: "Ada", email: "ada@example.test" },
  }),
}));
vi.mock("~/lib/route-guards", () => ({ useRequireReviewer: () => ({ authorized: () => true }) }));
vi.mock("~/lib/reviewer-actions", () => ({ fetchReviewerSubmissionDetail: vi.fn(), submitReview: vi.fn() }));
vi.mock("~/lib/cfp-store", () => ({ fetchProposals: vi.fn(), loadSubmissionToStore: vi.fn(), resetProposalData: vi.fn() }));
vi.mock("~/lib/gamification-profile", () => ({ getMyGamificationProfileSummary: vi.fn(), updateMyGamificationBadgeVisibility: vi.fn(), updateMyGamificationVisibility: vi.fn() }));
vi.mock("~/lib/partner-contact-consent-actions", () => ({ getMyPartnerContactConsentSummaries: vi.fn(), grantMyPartnerContactConsent: vi.fn(), withdrawMyPartnerContactConsent: vi.fn() }));
vi.mock("~/lib/gamification-hievents-actions", () => ({ getMyHiEventsEvidenceStatus: vi.fn(), refreshMyHiEventsEvidence: vi.fn() }));
vi.mock("~/lib/profile-actions", () => ({ updateMyProfile: vi.fn() }));
vi.mock("~/lib/mission-code-redemption-action", () => ({ redeemMissionCode: vi.fn() }));

import ReviewPage from "~/routes/reviewer/[id]";
import RedeemMissionPage from "~/routes/missions/redeem";
import ProfilePage from "~/routes/user/profile";
import { expectFragments, expectInOrder, markup } from "./route-markup-test-helper";

// Each page's leading createSignal calls, in creation order, with the default each one receives.
// render() seeds a signal by name and fails when the page's signal order no longer matches.
const reviewSignals = { submission: null, myReview: null, allReviews: [], loading: true, saving: false, scores: {}, notes: "", isLlm: false };
const redeemSignals = {
  code: "", pendingVersion: 0, isRedeeming: false, result: undefined, challenge: undefined, retryAt: 0, tick: expect.any(Number),
  requestError: "", consentBusy: false, consentMessage: "", consentMessageKind: "success",
};
const profileSignals = { user: { id: "user-1", name: "Ada", email: "ada@example.test" }, isUpdating: false, imgError: false, message: null };

type Seeds<Signals> = Partial<Record<keyof Signals, unknown>>;

async function render<Signals extends Record<string, unknown>>(page: unknown, signals: Signals, seeds: Seeds<Signals>) {
  await (page as { ready: Promise<void> }).ready;
  const names = Object.keys(signals);
  state.seeds = new Map(Object.entries(seeds).map(([name, value]) => [names.indexOf(name), value]));
  state.defaults = [];
  const html = renderToString(() => (page as Component)({}));
  expect(state.defaults.slice(0, names.length)).toEqual(Object.values(signals));
  return markup(html);
}

beforeEach(() => {
  state.role = "reviewer";
});

const submission = {
  session_title: "Signals",
  abstract: "<p>Abstract</p>",
  key_takeaways: "<p>Takeaways</p>",
  technical_requirements: "Projector",
  notes: "Extra",
};
const review = {
  id: "r1", score_relevance: 5, score_originality: 4, score_depth: 3, score_clarity: 2, score_takeaways: 1, score_engagement: 5,
  notes: "Strong", is_llm_suspected: true, expand: { reviewer: { name: "Grace Hopper" } },
};
const submissionSections = ["<h1>Signals</h1>", "<h3>Abstract</h3>", "<p>Abstract</p>", "<h3>Key Takeaways</h3>", "<p>Takeaways</p>"];
const logistics = ["<h3>Technical Requirements</h3>", "<p>Projector</p>", "<h3>Extra Notes</h3>", "<p>Extra</p>"];
const criteria = ["Relevance", "Originality", "Depth", "Clarity", "Takeaways", "Engagement"];
const scoreValue = (criterion: string, value: number | string) => `<div><span>${criterion}</span><span>${value}</span></div>`;
const scoreField = (criterion: string, value: number) => scoreValue(criterion, value)
  + `<input type="range" min="1" max="5" step="1" value="${value}" aria-label="${criterion} score">`
  + `<div><div role="slider" tabindex="0" aria-label="${criterion} score" aria-valuemin="1" aria-valuemax="5" aria-valuenow="${value}">`;
const scoreValues = (values: (number | string)[]) => criteria.map((criterion, index) => scoreValue(criterion, values[index]));
const scoreFields = (values: number[]) => criteria.map((criterion, index) => scoreField(criterion, values[index]));
const scoreTicks = /<div><span>1<\/span><span>2<\/span><span>3<\/span><span>4<\/span><span>5<\/span><\/div>/g;
const reviewForm = [
  "<h2>Your review</h2>",
  '<label for="review-notes"><span>Private notes</span></label>',
  '<p id="review-notes-help">Visible only to the committee.</p>',
];

describe("reviewer page states", () => {
  it("renders the reviewer form for a loaded submission", async () => {
    const html = await render(ReviewPage, reviewSignals, {
      submission, loading: false, scores: { score_relevance: 3, score_depth: 0 }, notes: "Note", isLlm: true,
    });
    expectInOrder(html, ["<h2>Your review</h2>", ...scoreFields([3, 1, 1, 1, 1, 1])]);
    expect(html.match(scoreTicks)).toHaveLength(criteria.length);
    expectFragments(html, [
      "<button><svg/>Back to reviews</button>",
      ...submissionSections,
      ...logistics,
      ...reviewForm,
      '<input type="checkbox" checked><span>Flag as AI/LLM Generated</span>',
      '<textarea id="review-notes" aria-describedby="review-notes-help" placeholder="Strengths, concerns, or questions">Note</textarea>',
      "<span>Total Score</span><span><span>3</span><span>/30</span></span>",
      "<button>Save review</button>",
    ], ["Back to admin", "Expenses and notes", "Committee Reviews", "<h3>Applicant</h3>"]);
  });

  it("renders the admin view with applicant, logistics and committee reviews", async () => {
    state.role = "admin";
    const adminSubmission = {
      ...submission,
      meta: { company_cover_expenses: "Yes", previous_presentation: "Conf", additional_info: "Info", organizer_notes: "Org" },
      expand: { applicant: { name: "Applicant", email: "applicant@example.test", bio: "Bio", expand: { user: { name: "User Name", email: "user@example.test" } } } },
    };
    const html = await render(ReviewPage, reviewSignals, { submission: adminSubmission, allReviews: [review, { id: "r2", score_relevance: 1 }], loading: false });
    expectFragments(html, [
      "<button><svg/>Back to admin</button>",
      ...submissionSections,
      "<h3><svg/> Expenses and notes</h3>",
      "<div>Covers Expenses?</div><div>Yes</div>",
      "<div>Previous Presentations</div><p>Conf</p>",
      '<div>Additional Info</div><p>"Info"</p>',
      "<div>Notes to Organizer (Admin Only)</div><p>Org</p>",
      "<h3>Applicant</h3>",
      "<h4>User Name</h4>",
      '<a href="mailto:user@example.test">user@example.test</a>',
      "<div>Bio</div>",
      ...logistics,
    ], ["Applicant</h4>", "applicant@example.test", "<h2>Your review</h2>", "Save review"]);
    expectInOrder(html, [
      "<h3>Committee Reviews (2)</h3>",
      '<input type="radio" name="reviews-accordion">',
      "<span>GR</span>",
      "<span>Grace</span></div><div><svg title=\"AI Flagged\"/><span>20</span></div>",
      ...scoreValues([5, 4, 3, 2, 1, 5]),
      '<div>"Strong"</div>',
      '<input type="radio" name="reviews-accordion">',
      "<span>RV</span>",
      "<span>Reviewer</span></div><div><span>1</span></div>",
      ...scoreValues([1, "", "", "", "", ""]),
    ]);
  });

  it("renders admin fallbacks without account details or logistics", async () => {
    const adminSubmissionSections = ["<button><svg/>Back to admin</button>", ...submissionSections, "<h3><svg/> Expenses and notes</h3>"];
    state.role = "admin";
    const sparse = { ...submission, technical_requirements: "", notes: "", meta: { company_cover_expenses: "No" }, expand: { applicant: { name: "", email: "only@example.test", bio: "" } } };
    expectFragments(await render(ReviewPage, reviewSignals, { submission: sparse, allReviews: [], loading: false }), [
      ...adminSubmissionSections,
      "<div>Covers Expenses?</div><div>No</div>",
      "<h4>Unknown</h4>",
      '<a href="mailto:only@example.test">only@example.test</a>',
      "<div>No bio provided.</div>",
      "<h3>Committee Reviews (0)</h3>",
      "<div>No reviews yet.</div>",
    ], ["Technical Requirements", "Extra Notes", "Previous Presentations", "Additional Info", "Notes to Organizer"]);

    expectFragments(await render(ReviewPage, reviewSignals, { submission: { ...submission, expand: { applicant: { email: "x@example.test" } } }, allReviews: [], loading: false }), [
      ...adminSubmissionSections,
      ...logistics,
      "<div>Covers Expenses?</div><div>N/A</div>",
      "<h3>Applicant</h3>",
      "<h4>Unknown</h4>",
      '<a href="mailto:x@example.test">x@example.test</a>',
      "<div>No bio provided.</div>",
    ]);

    expectFragments(await render(ReviewPage, reviewSignals, { submission: { ...submission, expand: {} }, allReviews: [], loading: false }), [
      ...adminSubmissionSections,
      ...logistics,
      "<div>Covers Expenses?</div><div>N/A</div>",
      "<h3>Committee Reviews (0)</h3>",
      "<div>No reviews yet.</div>",
    ], ["<h3>Applicant</h3>", "mailto:"]);
  });

  it("renders the saving state", async () => {
    const html = await render(ReviewPage, reviewSignals, { submission, loading: false, saving: true });
    expectInOrder(html, ["<h2>Your review</h2>", ...scoreFields([1, 1, 1, 1, 1, 1])]);
    expect(html.match(scoreTicks)).toHaveLength(criteria.length);
    expectFragments(html, [
      "<button><svg/>Back to reviews</button>",
      ...submissionSections,
      ...logistics,
      ...reviewForm,
      '<input type="checkbox"><span>Flag as AI/LLM Generated</span>',
      '<textarea id="review-notes" aria-describedby="review-notes-help" placeholder="Strengths, concerns, or questions"></textarea>',
      "<span>Total Score</span><span><span>0</span><span>/30</span></span>",
      "<button disabled><span></span></button>",
    ], ["Save review"]);
  });
});

const consent = { activityId: "act-1", partner: { name: "Acme" }, activityLabel: "Booth", noticeVersion: "v1", state: "available" };
const now = Date.now();
const codeInput = (attributes: string) =>
  `<input id="mission-code" name="mission-code" type="text" value="" placeholder="WTS26-XXXXXXXX-XXXXXXXX" autocomplete="off" autocapitalize="characters" ${attributes}>`;
const statusRegion = '<div role="status" aria-live="polite" tabindex="-1">';
const alertRegion = '<div role="alert" aria-live="polite" tabindex="-1">';
const codeForm = (busy: boolean) => `<form aria-busy="${busy}"><div><label for="mission-code"><span>Mission code</span></label>`;
const idleForm = codeForm(false);
const enabledCodeInput = codeInput('aria-describedby="mission-code-help"');
const disabledCodeInput = codeInput('disabled aria-describedby="mission-code-help"');

describe("mission redemption result states", () => {
  it.each<[string, Seeds<typeof redeemSignals>, string[], string[]]>([
    ["accepted with rewards", {
      result: {
        status: "accepted", title: "Accepted", message: "Done", mission: { title: "Mission", summary: "Summary" },
        badges: [{ name: "First" }], xpAwarded: 20, profile: { totalXp: 120, accessLevelLabel: "Level 2", repairState: "rebuild_pending", supportReference: "SUP-1" },
        partnerFollowUp: consent, supportMessage: "Support", supportReference: "REF-1",
      },
      consentMessage: "Saved",
      consentMessageKind: "error",
    }, [
      idleForm,
      enabledCodeInput,
      '<button type="submit">Redeem code</button>',
      `${statusRegion}<div><svg/><div><h2>Accepted</h2><p>Done</p><div><p>Mission</p><p>Summary</p></div>`,
      '<ul role="list"><li><span>Badge unlocked:</span> First</li></ul>',
      "<p>20 XP recorded. Total: 120 XP / Level 2</p>",
      "<p>Your progress is saved, but totals need repair. Support reference: <span>SUP-1</span>.</p>",
      "<legend>Optional partner follow-up</legend>",
      "<p>WhatTheStack may share your current name and email once with Acme for follow-up about Booth. Notice: v1.</p>",
      '<label for="partner-follow-up-act-1"><input id="partner-follow-up-act-1" name="partner-follow-up" type="checkbox"><span>I agree to this optional contact sharing.</span></label>',
      '<button type="submit">Allow follow-up</button>',
      "<p>Consent does not affect mission progress, badges, or XP. Withdraw in your profile before sharing; withdrawal cannot undo a completed handoff.</p>",
      '<p role="alert">Saved</p>',
      "<p>Support</p>",
      "<p>Support reference: REF-1</p>",
    ], []],
    ["already redeemed", {
      result: { status: "already_redeemed", title: "Again", message: "Seen", xpAwarded: 0, profile: { totalXp: 5, accessLevelLabel: "Level 1" }, partnerFollowUp: { ...consent, state: "granted" } },
      consentMessage: "Fine",
      consentMessageKind: "success",
    }, [
      idleForm,
      enabledCodeInput,
      '<button type="submit">Redeem code</button>',
      `${statusRegion}<div><svg/><div><h2>Again</h2><p>Seen</p>`,
      "<p>Already redeemed. No extra XP added. Total: 5 XP / Level 1</p>",
      '<p role="status">Fine</p>',
    ], ["Allow follow-up", "XP recorded"]],
    ["saved without XP", {
      result: { status: "accepted", title: "Accepted", message: "No XP", profile: { totalXp: 5, accessLevelLabel: "Level 1" }, badges: [] },
      consentBusy: true,
    }, [
      idleForm,
      enabledCodeInput,
      '<button type="submit">Redeem code</button>',
      `${statusRegion}<div><svg/><div><h2>Accepted</h2><p>No XP</p>`,
      "<p>Progress saved. No extra XP under the current scoring limits. Total: 5 XP / Level 1</p>",
    ], ["Badge unlocked", "Optional partner follow-up"]],
    ["rate limited", { result: { status: "rate_limited", title: "Slow down", message: "Wait" }, retryAt: now + 30_500, tick: now }, [
      idleForm,
      '<button type="submit" disabled>Redeem code</button>',
      disabledCodeInput,
      '<p role="status">Retry available in 31 seconds. No automatic retries.</p>',
      `${alertRegion}<div><svg/><div><h2>Slow down</h2><p>Wait</p>`,
      '<button type="button" disabled>Retry in 31s</button>',
    ], []],
    ["unavailable", { result: { status: "unavailable", title: "Down", message: "Later" } }, [
      idleForm,
      enabledCodeInput,
      '<button type="submit">Redeem code</button>',
      `${alertRegion}<div><svg/><div><h2>Down</h2><p>Later</p>`,
      '<button type="button">Try again</button>',
    ], ["Retry in"]],
    ["incorrect answers", { result: { status: "questions_incorrect", title: "Wrong", message: "Again" }, code: "WTS26-CODE" }, [
      idleForm,
      '<button type="submit">Redeem code</button>',
      '<input id="mission-code" name="mission-code" type="text" value="WTS26-CODE" placeholder="WTS26-XXXXXXXX-XXXXXXXX" autocomplete="off" autocapitalize="characters" aria-describedby="mission-code-help">',
      '<button type="button">Try questions again</button>',
      `${alertRegion}<div><svg/><div><h2>Wrong</h2><p>Again</p>`,
      '<button type="button">Start a new attempt</button>',
    ], []],
    ["question conflict while redeeming", { result: { status: "question_conflict", title: "Conflict", message: "Again" }, isRedeeming: true }, [
      codeForm(true),
      disabledCodeInput,
      '<button type="submit" disabled><span aria-hidden="true"></span> Redeeming…</button>',
      '<button type="button" disabled>Try questions again</button>',
      `${alertRegion}<div><svg/><div><h2>Conflict</h2><p>Again</p>`,
      '<button type="button" disabled>Try again</button>',
    ], []],
    ["questions pending for this user", {
      result: { status: "questions_required", title: "Questions", message: "Answer" },
      challenge: { value: { questions: [] }, userId: "user-1", sourceCode: "c" },
    }, [
      idleForm,
      disabledCodeInput,
      '<button type="submit" disabled>Redeem code</button>',
      '<form data-user="user-1"></form>',
      `${alertRegion}<div><svg/><div><h2>Questions</h2><p>Answer</p>`,
    ], ["Try questions again"]],
    ["questions pending for another user", {
      result: { status: "questions_incomplete", title: "Questions", message: "Answer" },
      challenge: { value: { questions: [] }, userId: "user-2", sourceCode: "c" },
    }, [
      idleForm,
      disabledCodeInput,
      '<button type="submit" disabled>Redeem code</button>',
      '<button type="button">Try questions again</button>',
      `${alertRegion}<div><svg/><div><h2>Questions</h2><p>Answer</p>`,
    ], ["data-user="]],
    ["a request error", { requestError: "Enter a mission code." }, [
      idleForm,
      codeInput('aria-describedby="mission-code-help mission-code-error" aria-invalid="true"'),
      '<button type="submit">Redeem code</button>',
      '<div id="mission-code-error" role="alert" tabindex="-1"><svg/><span>Enter a mission code.</span></div>',
    ], [statusRegion, alertRegion]],
  ])("renders %s", async (_name, seeds, present, absent) => {
    expectFragments(await render(RedeemMissionPage, redeemSignals, seeds), [
      '<h1 id="mission-redeem-heading">Redeem code</h1>',
      '<a href="/user/profile#gamification">View achievements</a>',
      ...present,
    ], absent);
  });
});

const profileHeader = [
  "<h1>Profile</h1>",
  '<nav aria-label="Profile sections"><a href="#profile-settings">Account</a><a href="#gamification">Achievements</a><a href="#proposals">Talk proposals</a></nav>',
  '<h2 id="profile-settings-heading">Account</h2>',
  '<p role="status">Achievements are unavailable. Refresh your profile to try again.</p>',
  '<h2 id="proposals-heading">Talk proposals</h2>',
];

describe("profile message states", () => {
  it.each([
    ["an error", { type: "error", text: "Could not save your profile. Try again." }, '<div role="alert"><svg/><span>Could not save your profile. Try again.</span></div>'],
    ["a success", { type: "success", text: "Profile saved." }, '<div role="status"><svg/><span>Profile saved.</span></div>'],
  ])("renders %s message and the saving button", async (_name, message, banner) => {
    expectFragments(await render(ProfilePage, profileSignals, { isUpdating: true, message }), [
      ...profileHeader,
      '<img src="https://www.gravatar.com/avatar/28ae5bf8fa0cde12855e61ac303859cc?s=200&amp;d=404" alt="Ada profile avatar">',
      "<p>Ada</p>",
      "<p>ada@example.test</p>",
      banner,
      '<input id="profile-name" type="text" name="name" autocomplete="name" value="Ada" placeholder="Enter your name">',
      '<input id="profile-email" type="email" value="ada@example.test" aria-describedby="profile-email-help" disabled>',
      '<button type="submit" disabled><span>Saving…</span></button>',
    ], ["Save changes"]);
  });

  it("renders initials after an avatar error", async () => {
    expectFragments(await render(ProfilePage, profileSignals, { user: { name: "", email: "zed@example.test" }, imgError: true }), [
      ...profileHeader,
      "<div><span>Z</span></div>",
      "<p>Your account</p>",
      "<p>zed@example.test</p>",
      '<input id="profile-name" type="text" name="name" autocomplete="name" value="" placeholder="Enter your name">',
      '<input id="profile-email" type="email" value="zed@example.test" aria-describedby="profile-email-help" disabled>',
      '<button type="submit"><span>Save changes</span></button>',
    ], ["<img", 'role="alert"']);
  });
});

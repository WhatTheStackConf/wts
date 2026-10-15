import type { Component, ParentProps } from "solid-js";
import { renderToString } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  writes: [] as Array<[number, unknown]>,
  signals: 0,
  programme: undefined as unknown,
  liveQa: vi.fn(),
  registrations: vi.fn(),
  reviewerDetail: vi.fn(),
  applicant: vi.fn(),
  setCfpStore: vi.fn(),
  feedback: vi.fn(),
}));

vi.mock("solid-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("solid-js")>();
  return {
    ...actual,
    onSettled: (effect: () => void) => effect(),
    createEffect: (compute: () => unknown, effect: (value: unknown) => unknown) => effect(compute()),
    createSignal: (value: unknown, options?: unknown) => {
      const id = state.signals++;
      const [read, write] = (actual.createSignal as (value: unknown, options?: unknown) => [() => unknown, (next: unknown) => unknown])(value, options);
      return [read, (next: unknown) => {
        state.writes.push([id, next]);
        return write(next);
      }];
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
vi.mock("@solidjs/meta", () => ({ Title: () => null, Meta: () => null }));
vi.mock("@solidjs/router", () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: "submission-1" }) }));
vi.mock("~/layouts/Layout", () => ({ Layout: (props: ParentProps) => <main>{props.children}</main> }));
vi.mock("~/components/cfp/CfpStepLayout", () => ({ CfpStepLayout: (props: ParentProps) => <main>{props.children}</main> }));
vi.mock("~/components/feedback/FeedbackForm", () => ({ FeedbackForm: () => null }));
vi.mock("~/components/feedback/feedback.css", () => ({}));
vi.mock("~/lib/async-resource", () => ({
  createAsyncResource: () => [Object.assign(() => state.programme, { loading: false, error: undefined }), { refetch: vi.fn() }],
}));
vi.mock("~/lib/auth-context", () => ({
  useAuth: () => ({
    isLoading: () => false,
    isAuthenticated: () => true,
    user: { id: "user-1", role: "reviewer" },
    record: { id: "user-1", name: "Ada Record", email: "ada@example.test" },
  }),
}));
vi.mock("~/lib/route-guards", () => ({
  useRequireCheckinOperator: () => ({ authorized: () => true, user: () => ({ id: "operator-1", role: "admin" }) }),
  useRequireReviewer: () => ({ authorized: () => true }),
  useRequireAuth: () => ({ authorized: () => true }),
}));
vi.mock("~/lib/live-qa-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("~/lib/live-qa-client")>(),
  liveQaRequest: state.liveQa,
  loadLiveQaProgramme: vi.fn(),
}));
vi.mock("~/lib/reviewer-actions", () => ({ fetchReviewerSubmissionDetail: state.reviewerDetail, submitReview: vi.fn() }));
vi.mock("~/lib/cfp-store", () => ({
  fetchApplicantData: state.applicant,
  updateApplicant: vi.fn(),
  useCfpStore: () => [{ formData: { full_name: "", previous_talks: "kept", social_handles: [] } }, state.setCfpStore],
}));
vi.mock("~/lib/feedback-client", () => ({ consumeFeedbackToken: () => "token-1", feedbackRequest: state.feedback }));

import { LiveQaClientError } from "~/lib/live-qa-client";
import { LiveQaPanel } from "./LiveQaPanel";
import RegistrationsPage from "./RegistrationsPage";
import ReviewPage from "~/routes/reviewer/[id]";
import Personal from "~/routes/cfp/02-personal";
import FeedbackPage from "~/routes/feedback";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function run(view: () => unknown) {
  state.writes.length = 0;
  state.signals = 0;
  renderToString(view as () => never);
  await flush();
  await flush();
  return state.writes;
}
async function page(component: unknown) {
  await (component as { ready: Promise<void> }).ready;
  return run(() => (component as Component)({}));
}

beforeEach(() => {
  vi.stubGlobal("window", { setInterval: () => 1, clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), location: {}, history: {} });
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  state.programme = { stages: [{ key: "alpha", name: "Alpha", sessions: [{ slug: "talk" }] }] };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const question = { id: "q1", body: "Why?", answered: false, own: true, created: "2026-10-16T09:00:00Z" };
const session = {
  sessionId: "s1", slug: "talk", title: "Talk", mode: "auto", accepting: true, startAt: null, endAt: "2026-10-16T10:00:00Z",
  serverNow: "2026-10-16T09:30:00Z", canModerate: false, questions: [question], page: 1, totalPages: 1,
};
const failedRead = [[0, undefined], [4, "Couldn't refresh questions. New questions are paused until a refresh succeeds."], [2, false], [3, false]];

describe("LiveQaPanel first refresh", () => {
  it("shows a valid session read", async () => {
    state.liveQa.mockResolvedValueOnce(session);
    expect(await run(() => <LiveQaPanel slug="talk" />)).toEqual([[2, true], [3, true], [0, session], [1, 1], [5, false], [4, ""], [2, false], [3, false]]);
    expect(state.liveQa).toHaveBeenLastCalledWith({ operation: "session", slug: "talk", page: 1 }, "user-1");
  });

  it.each([
    ["a missing response", null],
    ["another slug", { ...session, slug: "other" }],
    ["a missing session id", { ...session, sessionId: 1 }],
    ["a non-boolean accepting flag", { ...session, accepting: "yes" }],
    ["a non-boolean moderation flag", { ...session, canModerate: 0 }],
    ["an unknown mode", { ...session, mode: "paused" }],
    ["an invalid server time", { ...session, serverNow: "later" }],
    ["an invalid start", { ...session, startAt: "soon" }],
    ["an invalid end", { ...session, endAt: "soon" }],
    ["another page", { ...session, page: 2 }],
    ["a fractional page count", { ...session, totalPages: 1.5 }],
    ["a negative page count", { ...session, totalPages: -1 }],
    ["non-list questions", { ...session, questions: {} }],
    ["too many questions", { ...session, questions: Array.from({ length: 51 }, (_, index) => ({ ...question, id: `q${index}` })) }],
    ["an empty question id", { ...session, questions: [{ ...question, id: "" }] }],
    ["a non-string question body", { ...session, questions: [{ ...question, body: 1 }] }],
    ["a non-boolean answered flag", { ...session, questions: [{ ...question, answered: "no" }] }],
    ["a non-boolean own flag", { ...session, questions: [{ ...question, own: 1 }] }],
    ["an invalid question time", { ...session, questions: [{ ...question, created: "now" }] }],
    ["a null question", { ...session, questions: [null] }],
  ])("rejects %s", async (_name, response) => {
    state.liveQa.mockResolvedValueOnce(response);
    expect(await run(() => <LiveQaPanel slug="talk" />)).toEqual([[2, true], [3, true], ...failedRead]);
  });

  it("accepts open, closed, and empty question pages", async () => {
    for (const valid of [{ ...session, mode: "open", startAt: "2026-10-16T09:00:00Z", endAt: null, questions: [], totalPages: 0 }, { ...session, mode: "closed", questions: [] }]) {
      state.liveQa.mockResolvedValueOnce(valid);
      expect((await run(() => <LiveQaPanel slug="talk" />)).slice(2, 3)).toEqual([[0, valid]]);
    }
  });

  it.each([401, 403])("revokes private data after a %s read", async (status) => {
    state.liveQa.mockRejectedValueOnce(new LiveQaClientError(status, "denied"));
    expect(await run(() => <LiveQaPanel slug="talk" />)).toEqual([
      [2, true], [3, true], [0, undefined], [0, undefined], [5, true], [10, false], [6, ""],
      [4, "Q&A access could not be verified. Log in again or refresh to check access."], [2, false], [3, false],
    ]);
  });

  it.each([new LiveQaClientError(500, "broken"), new Error("offline")])("keeps a generic read failure", async (error) => {
    state.liveQa.mockRejectedValueOnce(error);
    expect(await run(() => <LiveQaPanel slug="talk" />)).toEqual([[2, true], [3, true], ...failedRead]);
  });
});

describe("registration roster refresh", () => {
  const roster = { refreshedAt: "2026-10-16T09:00:00Z", registrations: [] };
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

  it("stores a parsed roster", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, roster)));
    const writes = await run(() => <RegistrationsPage />);
    expect(writes).toEqual([[2, undefined], [3, true], [4, ""], [2, roster], [3, false]]);
  });

  it.each([401, 403])("clears the search after a %s response", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(status, {})));
    expect(await run(() => <RegistrationsPage />)).toEqual([[2, undefined], [3, true], [4, ""], [1, ""], [4, "Access denied. Sign in with an operator account."], [3, false]]);
  });

  it.each([
    ["a server error", async () => reply(502, {})],
    ["an invalid roster", async () => reply(200, { refreshedAt: "later", registrations: [] })],
    ["a network failure", async () => { throw new Error("Access denied by proxy"); }],
    ["a non-error rejection", async () => { throw "offline"; }],
  ])("reports %s as unavailable unless the message is an access denial", async (name, fetch) => {
    vi.stubGlobal("fetch", vi.fn(fetch));
    const message = name === "a network failure" ? "Access denied by proxy" : "Registrations unavailable. Refresh to try again.";
    expect(await run(() => <RegistrationsPage />)).toEqual([[2, undefined], [3, true], [4, ""], [4, message], [3, false]]);
  });
});

describe("reviewer submission load", () => {
  const submission = { id: "submission-1", session_title: "Talk" };
  const review = { id: "r1", score_relevance: 5, score_originality: 4, score_depth: 3, score_clarity: 2, score_takeaways: 1, score_engagement: 5, notes: "", is_llm_suspected: true };

  it("restores the reviewer's own review", async () => {
    state.reviewerDetail.mockResolvedValueOnce({ success: true, data: { submission, reviews: [review], userRole: "reviewer" } });
    const writes = await page(ReviewPage);
    expect(writes).toEqual([[3, true], [0, submission], [1, review], [5, { score_relevance: 5, score_originality: 4, score_depth: 3, score_clarity: 2, score_takeaways: 1, score_engagement: 5 }], [6, ""], [7, true], [3, false]]);
    expect(Object.keys(writes[3][1] as object)).toEqual(["score_relevance", "score_originality", "score_depth", "score_clarity", "score_takeaways", "score_engagement"]);
  });

  it("starts a new review at the minimum scores", async () => {
    state.reviewerDetail.mockResolvedValueOnce({ success: true, data: { submission, reviews: [], userRole: "reviewer" } });
    expect(await page(ReviewPage)).toEqual([[3, true], [0, submission], [5, { score_relevance: 1, score_originality: 1, score_depth: 1, score_clarity: 1, score_takeaways: 1, score_engagement: 1 }], [3, false]]);
  });

  it("lists every committee review for an admin", async () => {
    state.reviewerDetail.mockResolvedValueOnce({ success: true, data: { submission, reviews: [review], userRole: "admin" } });
    expect(await page(ReviewPage)).toEqual([[3, true], [0, submission], [2, [review]], [3, false]]);
    state.reviewerDetail.mockResolvedValueOnce({ success: true, data: { submission, userRole: "admin" } });
    expect(await page(ReviewPage)).toEqual([[3, true], [0, submission], [2, []], [3, false]]);
  });

  it("keeps the form empty after a failed or rejected load", async () => {
    state.reviewerDetail.mockResolvedValueOnce({ success: false, error: "no" });
    expect(await page(ReviewPage)).toEqual([[3, true], [3, false]]);
    state.reviewerDetail.mockRejectedValueOnce(new Error("offline"));
    expect(await page(ReviewPage)).toEqual([[3, true], [3, false]]);
  });
});

describe("CFP personal details load", () => {
  it.each([
    ["an array", ["@ada", "ada.dev"], ["@ada", "ada.dev"]],
    ["a string", "@ada", ["@ada"]],
    ["an empty string", "", []],
    ["no handles", undefined, []],
  ])("merges applicant data with %s of social handles", async (_name, handles, expected) => {
    state.setCfpStore.mockClear();
    state.applicant.mockResolvedValueOnce([{ id: "applicant-1", bio: "Bio", affiliation: "WTS", social_handles: handles, preferred_contact_method: "email" }]);
    await page(Personal);
    expect(state.setCfpStore).toHaveBeenCalledTimes(1);
    const [key, value] = state.setCfpStore.mock.calls[0];
    expect(key).toBe("formData");
    expect(JSON.stringify(value)).toBe(JSON.stringify({
      full_name: "Ada Record", previous_talks: "kept", social_handles: expected, email: "ada@example.test",
      short_bio: "Bio", affiliation: "WTS", preferred_contact: "email", applicant_id: "applicant-1",
    }));
  });

  it("fills only account fields without an applicant record", async () => {
    state.setCfpStore.mockClear();
    state.applicant.mockResolvedValueOnce([]);
    await page(Personal);
    expect(JSON.stringify(state.setCfpStore.mock.calls[0][1])).toBe(JSON.stringify({
      full_name: "Ada Record", previous_talks: "kept", social_handles: [], email: "ada@example.test",
      short_bio: "", affiliation: "", preferred_contact: "", applicant_id: "",
    }));
  });
});

describe("feedback invitation inspection", () => {
  it.each([
    ["ready", [[0, "loading"], [1, { id: "survey" }], [0, "ready"]]],
    ["unavailable", [[0, "loading"], [0, "unavailable"]]],
    ["invalid_answers", [[0, "loading"], [0, "unavailable"]]],
    ["submitted", [[0, "loading"], [0, "unavailable"]]],
    ["used", [[0, "loading"], [0, "used"]]],
    ["expired", [[0, "loading"], [0, "expired"]]],
    ["closed", [[0, "loading"], [0, "closed"]]],
    ["invalid", [[0, "loading"], [0, "invalid"]]],
  ])("maps a %s inspection", async (result, writes) => {
    state.feedback.mockResolvedValueOnce(result === "ready" ? { state: "ready", survey: { id: "survey" } } : { state: result });
    expect(await run(() => <FeedbackPage />)).toEqual(writes);
    expect(state.feedback).toHaveBeenLastCalledWith({ action: "inspect", token: "token-1" });
  });
});

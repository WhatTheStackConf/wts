import { renderToString } from "@solidjs/web";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { LiveQaProgramme } from "~/lib/live-qa-contract";

const state = vi.hoisted(() => ({
  programme: undefined as unknown,
  stage: undefined as string | undefined,
  auth: { loading: false, authenticated: true, user: { id: "user-1", role: "attendee" } as { id: string; role: string } | null },
}));

vi.mock("@solidjs/router", () => ({ useSearchParams: () => [{ get stage() { return state.stage; } }, vi.fn()] }));
vi.mock("~/lib/async-resource", () => ({
  createAsyncResource: () => [Object.assign(() => state.programme, { loading: false, error: undefined }), { refetch: vi.fn() }],
}));
vi.mock("~/lib/auth-context", () => ({
  useAuth: () => ({
    isLoading: () => state.auth.loading,
    isAuthenticated: () => state.auth.authenticated,
    get user() { return state.auth.user; },
  }),
}));

import { LiveQaPanel } from "./LiveQaPanel";
import { LiveQaStages } from "./LiveQaStages";

const text = (html: string) => html.replace(/<!--.*?-->/g, "");
const labels = (html: string) => [...text(html).matchAll(/<\/h4><p class="text-sm ([^"]*)">([^<]*)<\/p>/g)].map((match) => [match[1], match[2]]);
const cards = (html: string) => [...text(html).matchAll(/<li class="rounded-xl border p-4 space-y-3 min-w-0 ([^"]*)">/g)].map((match) => match[1]);

function programme(serverNow: string): LiveQaProgramme {
  return {
    day: { key: "main", localDate: "2026-10-16", title: "Main day" },
    serverNow,
    stages: [
      {
        key: "alpha",
        name: "Alpha",
        locationLabel: "Hall A",
        sessions: [
          { slug: "done", title: "Done talk", startAt: "2026-10-16T08:00:00Z", endAt: "2026-10-16T09:00:00Z", accepting: false, mode: "auto" },
          { slug: "now", title: "Now talk", startAt: "2026-10-16T09:00:00Z", endAt: "2026-10-16T10:00:00Z", accepting: true, mode: "auto" },
          { slug: "closed", title: "Closed talk", startAt: "2026-10-16T10:00:00Z", endAt: "2026-10-16T11:00:00Z", accepting: false, mode: "closed" },
          { slug: "later", title: "Later talk", startAt: "2026-10-16T11:00:00Z", endAt: "2026-10-16T12:00:00Z", accepting: false, mode: "auto" },
          { slug: "early-open", title: "Early open talk", startAt: "2026-10-16T11:00:00Z", endAt: "2026-10-16T12:00:00Z", accepting: true, mode: "open" },
          { slug: "now-closed", title: "Now closed talk", startAt: "2026-10-16T09:00:00Z", endAt: "2026-10-16T10:00:00Z", accepting: false, mode: "closed" },
        ],
      },
      { key: "beta", name: "Beta", locationLabel: "", sessions: [] },
    ],
  };
}

beforeEach(() => {
  state.programme = programme("2026-10-16T09:30:00Z");
  state.stage = undefined;
  state.auth = { loading: false, authenticated: true, user: { id: "user-1", role: "attendee" } };
});

describe("LiveQaStages talk status", () => {
  it("labels and highlights each talk from verified server time", () => {
    const html = renderToString(() => <LiveQaStages />);
    expect(labels(html)).toEqual([
      ["text-primary-200", "Finished · Questions closed"],
      ["font-bold text-secondary-300", "Scheduled now · Questions open"],
      ["text-primary-200", "Upcoming · Questions closed"],
      ["text-primary-200", "Upcoming · Questions not open yet"],
      ["font-bold text-secondary-300", "Upcoming · Questions open"],
      ["font-bold text-secondary-300", "Scheduled now · Questions closed"],
    ]);
    expect(cards(html)).toEqual([
      "border-white/15",
      "border-primary-400 bg-primary-400/10",
      "border-white/15",
      "border-white/15",
      "border-primary-400 bg-primary-400/10",
      "border-primary-400 bg-primary-400/10",
    ]);
  });

  it("marks every talk unverified when the server time is missing", () => {
    state.programme = programme("");
    const html = renderToString(() => <LiveQaStages />);
    expect(new Set(labels(html).map(([, label]) => label))).toEqual(new Set(["Question availability unverified"]));
  });

  it("treats the end instant as finished and the start instant as current", () => {
    state.programme = programme("2026-10-16T10:00:00Z");
    const html = renderToString(() => <LiveQaStages />);
    expect(labels(html).slice(0, 3)).toEqual([
      ["text-primary-200", "Finished · Questions closed"],
      ["font-bold text-secondary-300", "Finished · Questions open"],
      ["font-bold text-secondary-300", "Scheduled now · Questions closed"],
    ]);
  });

  it("reports an unknown stage and falls back to the first stage", () => {
    state.stage = "missing";
    const html = text(renderToString(() => <LiveQaStages />));
    expect(html).toContain("That stage is unavailable. Showing Alpha instead. Choose a stage above.");
  });
});

describe("LiveQaPanel initial private view", () => {
  it("renders the signed-in question form before the first refresh", () => {
    expect(text(renderToString(() => <LiveQaPanel slug="now" />))).toBe(
      '<a class="mt-6 inline-flex min-h-11 items-center underline underline-offset-4 text-secondary-300" href="/mc?stage=alpha">Main-day Q&A · Alpha · Choose another talk</a><section id="live-qa" aria-labelledby="live-qa-heading" class="glass-panel rounded-2xl min-w-0 p-4 sm:p-6 md:p-8 mt-8 scroll-mt-24 space-y-5"><header class="space-y-2"><h2 id="live-qa-heading" class="text-2xl font-bold text-white">Live Q&A</h2><p class="text-sm text-primary-200">Private: only you, MCs and administrators can read your questions.</p></header><div class="space-y-5"><div class="flex flex-wrap items-center justify-between gap-3"><div role="status" class="text-sm"><span>Question availability not verified.</span></div><button type="button" class="btn btn-outline min-h-12 whitespace-nowrap">Refresh questions</button></div><form class="space-y-3"><label for="live-qa-question" class="block font-bold text-white">Your question</label><p id="live-qa-draft-help" class="text-sm text-primary-200">About this session. No names or contact details needed.</p><textarea id="live-qa-question" name="question" class="textarea textarea-bordered w-full min-w-0 min-h-28 text-base" rows="3" aria-describedby="live-qa-draft-help live-qa-draft-count"></textarea><p id="live-qa-draft-count" class="text-primary-200 text-sm" aria-live="polite">0 / 1000 characters</p><button type="submit" class="btn btn-primary min-h-12 w-full sm:w-auto whitespace-nowrap" disabled>Send question</button></form><details class="text-sm text-primary-200"><summary class="cursor-pointer min-h-12 py-3 text-white focus-visible:outline-2 focus-visible:outline-primary-400">How timing works</summary><p>Questions open during the scheduled slot and remain readable afterward. MCs can override timing for delays; “Use agenda timing” clears the override.</p></details></div></section>',
    );
  });

  it("offers login when the visitor is signed out", () => {
    state.auth = { loading: false, authenticated: false, user: null };
    const html = text(renderToString(() => <LiveQaPanel slug="now" />));
    expect(html).toContain("Log in to ask and read your questions.");
    expect(html).toContain('href="/login?redirect_url=%2Fmc%3Fsession%3Dnow%23live-qa"');
  });
});

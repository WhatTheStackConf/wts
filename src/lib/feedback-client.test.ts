import { describe, expect, it, vi } from "vite-plus/test";
import { consumeFeedbackToken, createFeedbackSubmission, feedbackRequest } from "./feedback-client";
import type { FeedbackAnswers, FeedbackResult } from "./feedback-contract";

const survey = { title: "WhatTheStack 2026 feedback", version: "v1", closesAt: "2026-10-05T21:59:00Z", sessions: [{ id: "session-a", title: "A real talk" }] };

describe("feedback transport", () => {
  it("sends credentials only in the POST body without cookies, referrers or caching", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: "ready", survey })));
    expect(await feedbackRequest({ action: "inspect", token }, fetcher)).toEqual({ state: "ready", survey });
    expect(fetcher).toHaveBeenCalledWith("/api/feedback", expect.objectContaining({
      method: "POST", credentials: "omit", referrerPolicy: "no-referrer", referrer: "", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ action: "inspect", token }),
    }));
  });
  it.each(["invalid", "used", "expired", "closed", "unavailable", "invalid_answers", "submitted"])("accepts the %s contract state", async (state) => {
    expect(await feedbackRequest({ action: "inspect", token }, vi.fn().mockResolvedValue(new Response(JSON.stringify({ state }), { status: state === "submitted" ? 200 : 400 })))).toEqual({ state });
  });
  it.each([
    { state: "unknown" }, { state: "ready" }, { state: "ready", survey: { ...survey, closesAt: "nope" } },
    { state: "ready", survey: { ...survey, sessions: [{ id: "x", title: "a" }, { id: "x", title: "b" }] } },
    { state: "ready", survey: { ...survey, version: "" } }, { state: "ready", survey: { ...survey, sessions: [null] } },
  ])("fails closed on malformed responses", async (body) => {
    expect(await feedbackRequest({ action: "inspect", token }, vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))).toEqual({ state: "unavailable" });
  });
  it("does not accept a ready response from a failed server request", async () => {
    expect(await feedbackRequest({ action: "inspect", token }, vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: "ready", survey }), { status: 503 })))).toEqual({ state: "unavailable" });
  });
  it("makes network errors retryable without leaking request details", async () => {
    expect(await feedbackRequest({ action: "inspect", token }, vi.fn().mockRejectedValue(new Error("offline")))).toEqual({ state: "unavailable" });
  });
});

const token = "a".repeat(43);
const answers = (): FeedbackAnswers => ({ overall: 4, parts: {}, keep: "Good talks", change: "", more: [], moreOther: "", sessions: [] });

describe("one-response submission", () => {
  it("deduplicates same-tick submissions and freezes exact answers for an ambiguous retry", async () => {
    let finish!: (result: FeedbackResult) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise<FeedbackResult>(resolve => { finish = resolve; })).mockResolvedValue({ state: "submitted" });
    const client = createFeedbackSubmission(token, "v1", request);
    const draft = answers();
    const first = client.submit(draft);
    const duplicate = client.submit({ ...draft, overall: 1 });
    expect(first).toBe(duplicate);
    expect(request).toHaveBeenCalledTimes(1);
    draft.keep = "Changed after sending";
    finish({ state: "unavailable" });
    expect(await first).toEqual({ state: "unavailable" });
    expect(client.locked()).toBe(true);
    expect(await client.submit({ ...answers(), overall: 2 })).toEqual({ state: "submitted" });
    expect(request.mock.calls[1][0]).toEqual({ action: "submit", token, version: "v1", answers: answers() });
    await client.submit(answers());
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("allows correction after a definite validation rejection", async () => {
    const request = vi.fn().mockResolvedValueOnce({ state: "invalid_answers" }).mockResolvedValue({ state: "submitted" });
    const client = createFeedbackSubmission(token, "v1", request);
    await client.submit(answers());
    expect(client.locked()).toBe(false);
    await client.submit({ ...answers(), overall: 5 });
    expect(request.mock.calls[1][0].answers.overall).toBe(5);
  });
  it("does not unlock an uncertain submission on a later validation failure", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({ state: "invalid_answers" });
    const client = createFeedbackSubmission(token, "v1", request);
    expect(await client.submit(answers())).toEqual({ state: "unavailable" });
    expect(await client.submit(answers())).toEqual({ state: "unavailable" });
    expect(client.locked()).toBe(true);
  });
});

describe("invitation fragment consumption", () => {
  it("takes an exact fragment token and immediately clears the address without storing it", () => {
    const history = { replaceState: vi.fn() };
    expect(consumeFeedbackToken({ hash: `#token=${token}`, pathname: "/feedback", search: "" }, history)).toBe(token);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/feedback");
  });
  it.each(["", "#token=short", `#token=${token}&x=1`, `#token=${token}&token=${token}`, `#TOKEN=${token}`, `#token=%61${"a".repeat(42)}`, `#${token}`, `#token=${"a".repeat(44)}`, `#token=${token}\n`])("rejects malformed fragments and never falls back to query credentials: %s", (hash) => {
    const history = { replaceState: vi.fn() };
    expect(consumeFeedbackToken({ hash, pathname: "/feedback", search: `?token=${token}` }, history)).toBeUndefined();
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/feedback");
  });
  it("fails closed when it cannot scrub the address", () => {
    expect(consumeFeedbackToken({ hash: `#token=${token}`, pathname: "/feedback", search: "" }, { replaceState() { throw new Error("denied"); } })).toBeUndefined();
  });
});

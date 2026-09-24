import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import PocketBase from "pocketbase";
import { startFeedbackPocketBase, type FeedbackPocketBaseFixture } from "./feedback-pocketbase-test-helper";
import { loadFeedbackResults } from "./feedback-results-store";
import { MAIN_FEEDBACK_KEY } from "./feedback-results";
let fixture: FeedbackPocketBaseFixture;
let surveyId: string;
const answers = { overall: 4, parts: {}, keep: "Synthetic keep", change: "", more: [], moreOther: "", sessions: [] };
beforeAll(async () => {
  fixture = await startFeedbackPocketBase();
  const survey = await fixture.pb.collection("feedback_surveys").create({ key: MAIN_FEEDBACK_KEY, title: "Main day synthetic", opens_at: "2026-09-01T00:00:00.000Z", closes_at: "2026-10-01T00:00:00.000Z", version: "v1", sessions: [{ id: "synthetic-session", title: "Synthetic session" }] });
  surveyId = survey.id;
  // Real records across the adapter's page boundary, not an SDK mock.
  for (let i = 0; i < 201; i++) await fixture.pb.collection("feedback_responses").create({ survey: survey.id, version: "v1", answers });
  const testSurvey = await fixture.pb.collection("feedback_surveys").create({ key: "organizer-test", title: "Test excluded", opens_at: "2026-09-01T00:00:00.000Z", closes_at: "2026-10-01T00:00:00.000Z", version: "v1", sessions: [{ id: "synthetic-session", title: "Synthetic session" }] });
  await fixture.pb.collection("feedback_responses").create({ survey: testSurvey.id, version: "v1", answers: { ...answers, overall: 1, keep: "EXCLUDED TEST COMMENT" } });
}, 30_000);
afterAll(async () => { await fixture?.cleanup(); });
describe("real PocketBase feedback projection", () => {
  it("reads every page, only the exact survey, and queries no invitations", async () => {
    const collection = vi.spyOn(fixture.pb, "collection");
    const result = await loadFeedbackResults(fixture.pb);
    expect(result.responseCount).toBe(201); expect(result.overall.mean).toBe(4);
    expect(result.comments[0].comments).toHaveLength(201);
    expect(JSON.stringify(result)).not.toContain("EXCLUDED TEST");
    expect(collection.mock.calls.every(([name]) => name === "feedback_surveys" || name === "feedback_responses")).toBe(true);
    collection.mockRestore();
  });
  it("fails closed for a persisted response from another version", async () => {
    const row = await fixture.pb.collection("feedback_responses").create({ survey: surveyId, version: "v2", answers });
    try { await expect(loadFeedbackResults(fixture.pb)).rejects.toThrow(); } finally { await fixture.pb.collection("feedback_responses").delete(row.id); }
  });
  it("fails closed for malformed persisted answers", async () => {
    const row = await fixture.pb.collection("feedback_responses").create({ survey: surveyId, version: "v1", answers: { overall: "invalid" } });
    try { await expect(loadFeedbackResults(fixture.pb)).rejects.toThrow(); } finally { await fixture.pb.collection("feedback_responses").delete(row.id); }
  });
  it("fails closed when the requested live survey is missing", async () => {
    const emptyFixture = await startFeedbackPocketBase();
    try { await expect(loadFeedbackResults(emptyFixture.pb)).rejects.toThrow("Survey unavailable"); } finally { await emptyFixture.cleanup(); }
  });
  it("fails closed on a dropped page record rather than returning partial totals", async () => {
    const real = fixture.pb.collection("feedback_responses");
    const original = real.getList.bind(real);
    const spy = vi.spyOn(real, "getList").mockImplementation(async (...args) => {
      const page = await original(...args);
      if (args[0] === 2) page.items = [];
      return page;
    });
    try { await expect(loadFeedbackResults(fixture.pb)).rejects.toThrow("Incomplete results"); } finally { spy.mockRestore(); }
  });
  it("keeps raw response collections locked to ordinary clients", async () => {
    const publicClient = new PocketBase(fixture.baseUrl);
    await expect(publicClient.collection("feedback_responses").getList(1, 1)).rejects.toMatchObject({ status: 403 });
  });
});

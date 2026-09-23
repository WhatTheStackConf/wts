import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { startFeedbackPocketBase, type FeedbackPocketBaseFixture } from "./feedback-pocketbase-test-helper";
import { FEEDBACK_MORE_OPTIONS, FEEDBACK_PARTS } from "./feedback-contract";

describe("invitation-only feedback public PocketBase boundary", () => {
  let fixture: FeedbackPocketBaseFixture;
  beforeAll(async () => { fixture = await startFeedbackPocketBase(); }, 20_000);
  afterAll(async () => { await fixture?.cleanup(); });
  async function command(body: unknown) {
    const response = await fetch(`${fixture.baseUrl}/api/wts/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { response, body: await response.json() };
  }
  it("commits an overall-only response and never exposes it through the used invitation", async () => {
    const { token, survey, invitation } = await fixture.invitation();
    expect((await command({ action: "submit", token, version: "v1", answers: { overall: 4 } })).body).toEqual({ state: "submitted" });
    expect((await fixture.pb.collection("feedback_invitations").getOne(invitation.id)).used).toBe(true);
    const responses = await fixture.pb.collection("feedback_responses").getFullList({ filter: `survey = '${survey.id}'` });
    expect(responses).toHaveLength(1);
    expect(responses[0].answers).toEqual({ overall: 4, parts: {}, keep: "", change: "", more: [], moreOther: "", sessions: [] });
    expect(responses[0].version).toBe("v1");
    expect(responses[0].id).not.toBe(invitation.id);
    for (const body of [{ action: "inspect", token }, { action: "submit", token, version: "v1", answers: { overall: 1 } }]) {
      expect((await command(body)).body).toEqual({ state: "used" });
    }
  });
  it("validates optional details against frozen sessions and commits the complete answer", async () => {
    const { token, survey } = await fixture.invitation();
    const answers = { overall: 5, parts: { content: 4, organisation: "na", venue: 3, connections: 5 }, keep: "Keep demos", change: "More seats", more: ["technical", "case_studies", "other"], moreOther: "More breaks", sessions: [{ sessionId: "synthetic-session", usefulness: 4, comment: "Useful" }] };
    expect((await command({ action: "submit", token, version: "v1", answers })).body).toEqual({ state: "submitted" });
    const responses = await fixture.pb.collection("feedback_responses").getFullList({ filter: `survey = '${survey.id}'` });
    expect(responses).toHaveLength(1);
    expect(responses[0].answers).toEqual(answers);
  });
  it.each([
    {}, { overall: 0 }, { overall: 6 }, { overall: 1.5 }, { overall: "4" },
    { overall: 4, email: "injection@example.test" }, { overall: 4, parts: { unknown: 3 } },
    { overall: 4, parts: { content: 0 } }, { overall: 4, keep: "x".repeat(2001) },
    { overall: 4, change: "x".repeat(2001) }, { overall: 4, moreOther: "Not selected" },
    { overall: 4, more: ["other"], moreOther: "x".repeat(501) },
    { overall: 4, more: ["other", "technical", "demos", "meeting"] },
    { overall: 4, more: ["technical", "technical"] }, { overall: 4, more: ["unknown"] },
    { overall: 4, sessions: [{ sessionId: "not-frozen", usefulness: 5 }] },
    { overall: 4, sessions: [{ sessionId: "synthetic-session", comment: "  " }] },
    { overall: 4, sessions: [{ sessionId: "synthetic-session", usefulness: 0 }] },
    { overall: 4, sessions: [{ sessionId: "synthetic-session", comment: "x".repeat(2001) }] },
    { overall: 4, sessions: [{ sessionId: "synthetic-session", comment: "fine", user: "injection" }] },
    { overall: 4, sessions: [{ sessionId: "synthetic-session", usefulness: 4 }, { sessionId: "synthetic-session", usefulness: 3 }] },
    { overall: 4, parts: null }, { overall: 4, more: null }, { overall: 4, sessions: null },
  ])("rejects malformed answers without consuming an invitation (%#)", async answers => {
    const { token, invitation, survey } = await fixture.invitation();
    expect((await command({ action: "submit", token, version: "v1", answers })).body).toEqual({ state: "invalid_answers" });
    expect((await fixture.pb.collection("feedback_invitations").getOne(invitation.id)).used).toBe(false);
    expect((await fixture.pb.collection("feedback_responses").getList(1, 1, { filter: `survey = '${survey.id}'` })).totalItems).toBe(0);
  });
  it("serializes concurrent submit attempts to exactly one unlinked response", async () => {
    const { token, survey, invitation } = await fixture.invitation();
    const results = await Promise.all(Array.from({ length: 16 }, () => command({ action: "submit", token, version: "v1", answers: { overall: 5 } })));
    expect(results.filter(r => r.body.state === "submitted")).toHaveLength(1);
    expect(results.filter(r => r.body.state === "used")).toHaveLength(15);
    expect((await fixture.pb.collection("feedback_responses").getList(1, 1, { filter: `survey = '${survey.id}'` })).totalItems).toBe(1);
    expect((await fixture.pb.collection("feedback_invitations").getOne(invitation.id)).used).toBe(true);
  });
  it("rolls back consumption when the actual database rejects the response insert, then permits retry", async () => {
    const { token, survey, invitation } = await fixture.invitation();
    await fixture.responseInsertFailure(true);
    try {
      expect((await command({ action: "submit", token, version: "v1", answers: { overall: 5 } })).body).toEqual({ state: "unavailable" });
      expect((await fixture.pb.collection("feedback_invitations").getOne(invitation.id)).used).toBe(false);
      expect((await fixture.pb.collection("feedback_responses").getList(1, 1, { filter: `survey = '${survey.id}'` })).totalItems).toBe(0);
    } finally { await fixture.responseInsertFailure(false); }
    expect((await command({ action: "submit", token, version: "v1", answers: { overall: 5 } })).body).toEqual({ state: "submitted" });
  });
  it("rejects expired, revoked, future, closed and stale-version submissions without consumption", async () => {
    const now = Date.now();
    const cases = [
      { invitationFields: { expires_at: new Date(now - 1000).toISOString() }, state: "expired" },
      { invitationFields: { revoked: true }, state: "invalid" },
      { surveyFields: { open: false }, state: "closed" },
      { surveyFields: { opens_at: new Date(now + 60_000).toISOString() }, state: "closed" },
      { surveyFields: { closes_at: new Date(now - 1000).toISOString() }, state: "closed" },
    ];
    for (const c of cases) {
      const { token, invitation, survey } = await fixture.invitation(c);
      expect((await command({ action: "inspect", token })).body).toEqual({ state: c.state });
      expect((await command({ action: "submit", token, version: "v1", answers: { overall: 5 } })).body).toEqual({ state: c.state });
      expect((await fixture.pb.collection("feedback_invitations").getOne(invitation.id)).used).toBe(false);
      expect((await fixture.pb.collection("feedback_responses").getList(1, 1, { filter: `survey = '${survey.id}'` })).totalItems).toBe(0);
    }
    const { token, invitation } = await fixture.invitation();
    expect((await command({ action: "submit", token, version: "stale", answers: { overall: 5 } })).body).toEqual({ state: "invalid_answers" });
    expect((await fixture.pb.collection("feedback_invitations").getOne(invitation.id)).used).toBe(false);
  });
  it("accepts every public-contract option and optional comment-only/usefulness-only reviews", async () => {
    for (const option of FEEDBACK_MORE_OPTIONS) {
      const { token } = await fixture.invitation();
      expect((await command({ action: "submit", token, version: "v1", answers: { overall: 1, parts: Object.fromEntries(FEEDBACK_PARTS.map(p => [p.id, "na"])), more: [option.id], sessions: [{ sessionId: "synthetic-session", usefulness: 5 }] } })).body).toEqual({ state: "submitted" });
    }
    const { token } = await fixture.invitation();
    expect((await command({ action: "submit", token, version: "v1", answers: { overall: 2, sessions: [{ sessionId: "synthetic-session", comment: "Comment only" }] } })).body).toEqual({ state: "submitted" });
  });
  it("locks collection CRUD and has no identity/date columns on responses or redemption timestamps", async () => {
    const { invitation, survey, token } = await fixture.invitation();
    await command({ action: "submit", token, version: "v1", answers: { overall: 4 } });
    const stored = (await fixture.pb.collection("feedback_responses").getFullList({ filter: `survey = '${survey.id}'` }))[0];
    const ids = { feedback_surveys: survey.id, feedback_invitations: invitation.id, feedback_responses: stored.id };
    for (const [collection, id] of Object.entries(ids)) {
      const schema = await fixture.pb.collections.getOne(collection);
      for (const rule of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"] as const) expect(schema[rule]).toBe(null);
      expect(schema.fields.some(f => f.type === "autodate")).toBe(false);
      for (const [method, path] of [["GET", ""], ["GET", `/${id}`], ["POST", ""], ["PATCH", `/${id}`], ["DELETE", `/${id}`]]) {
        const response = await fetch(`${fixture.baseUrl}/api/collections/${collection}/records${path}`, { method, ...(method === "POST" || method === "PATCH" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}) });
        expect(response.ok).toBe(false);
      }
    }
    expect((await fixture.pb.collections.getOne("feedback_responses")).fields.map(f => f.name).sort()).toEqual(["answers", "id", "survey", "version"]);
    expect(Object.keys(stored).sort()).toEqual(["answers", "collectionId", "collectionName", "id", "survey", "version"]);
    expect((await fixture.pb.collections.getOne("feedback_invitations")).fields.map(f => f.name).sort()).toEqual(["email", "expires_at", "id", "revoked", "source_key", "survey", "token_hash", "used"]);
  });
  it("freezes survey semantics after issuing invitations and cannot reset a consumed allowance", async () => {
    const { token, survey, invitation } = await fixture.invitation();
    for (const change of [{ version: "v2" }, { sessions: [{ id: "replacement", title: "Replacement" }] }]) {
      await expect(fixture.pb.collection("feedback_surveys").update(survey.id, change)).rejects.toMatchObject({ status: 400 });
    }
    await command({ action: "submit", token, version: "v1", answers: { overall: 3 } });
    await expect(fixture.pb.collection("feedback_invitations").update(invitation.id, { used: false })).rejects.toMatchObject({ status: 400 });
  });
  it("does not consume malformed, identity-injected or oversized direct endpoint requests", async () => {
    const { token, invitation } = await fixture.invitation();
    for (const body of [null, [], {}, { action: "inspect", token: "bad" }, { action: "inspect", token, email: "private@example.test" }, { action: "submit", token, version: "v1", answers: { overall: 4 }, user: "private" }]) {
      expect((await command(body)).body).toEqual({ state: "invalid" });
    }
    const oversized = await command({ action: "submit", token, version: "v1", answers: { overall: 4, keep: "x".repeat(4 * 1024 * 1024 + 1) } });
    expect(oversized.body.state === "invalid" || oversized.response.status === 413).toBe(true);
    const get = await fetch(`${fixture.baseUrl}/api/wts/feedback`);
    expect(get.ok).toBe(false);
    const crossOrigin = await fetch(`${fixture.baseUrl}/api/wts/feedback`, { method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/json" }, body: JSON.stringify({ action: "inspect", token }) });
    expect(await crossOrigin.json()).toEqual({ state: "invalid" });
    expect((await fixture.pb.collection("feedback_invitations").getOne(invitation.id)).used).toBe(false);
  });
  it("bounds unauthenticated abuse without maintaining an IP/token identity bucket", async () => {
    // Separate process so this burst cannot rate-limit the other test cases.
    const isolated = await startFeedbackPocketBase();
    try {
      const results = [];
      for (let i = 0; i < 601; i++) {
        const response = await fetch(`${isolated.baseUrl}/api/wts/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        results.push(await response.json());
      }
      expect(results.filter(r => r.state === "invalid")).toHaveLength(600);
      expect(results[600]).toEqual({ state: "unavailable" });
    } finally { await isolated.cleanup(); }
  }, 20_000);
  it("does not log bearer secrets or answers, including on failure, with real PB logging enabled", async () => {
    const isolated = await startFeedbackPocketBase();
    try {
      const { token } = await isolated.invitation();
      const answer = "synthetic-private-comment-do-not-log";
      const post = (body: unknown) => fetch(`${isolated.baseUrl}/api/wts/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      expect(await (await post({ action: "submit", token, version: "v1", answers: { overall: 5, keep: answer } })).json()).toEqual({ state: "submitted" });
      await post({ action: "submit", token, version: "v1", answers: { overall: 5, keep: answer.repeat(5000) } });
      // Shutdown flushes PB's batched logs; no sleeps or production log reads.
      await isolated.restart();
      const logs = await isolated.pb.send<{ items: unknown[] }>("/api/logs?perPage=500", { method: "GET" });
      expect(logs.items.length).toBeGreaterThan(0);
      const text = JSON.stringify(logs.items) + isolated.logs();
      expect(text.includes(token)).toBe(false);
      expect(text.includes(answer)).toBe(false);
    } finally { await isolated.cleanup(); }
  });
  it("uniquely scopes allowance issuance to survey/source and token digest", async () => {
    const { invitation, survey } = await fixture.invitation();
    await expect(fixture.invitation({ survey: survey.id, invitationFields: { source_key: invitation.source_key } })).rejects.toMatchObject({ status: 400 });
    await expect(fixture.invitation({ invitationFields: { token_hash: invitation.token_hash } })).rejects.toMatchObject({ status: 400 });
    // Shared addresses are not silently collapsed into one person's allowance.
    const other = await fixture.invitation({ survey: survey.id, invitationFields: { email: invitation.email } });
    expect(other.invitation.id).not.toBe(invitation.id);
  });
  it("close/revoke races cannot create a response without consuming the same allowance", async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const revoke = attempt % 2 === 1;
      const { token, survey, invitation } = await fixture.invitation();
      const [submitted] = await Promise.all([
        command({ action: "submit", token, version: "v1", answers: { overall: 4 } }),
        revoke ? fixture.pb.collection("feedback_invitations").update(invitation.id, { revoked: true }) : fixture.pb.collection("feedback_surveys").update(survey.id, { open: false }),
      ]);
      expect(["submitted", revoke ? "invalid" : "closed"]).toContain(submitted.body.state);
      const accepted = submitted.body.state === "submitted";
      expect((await fixture.pb.collection("feedback_invitations").getOne(invitation.id)).used).toBe(accepted);
      expect((await fixture.pb.collection("feedback_responses").getList(1, 1, { filter: `survey = '${survey.id}'` })).totalItems).toBe(accepted ? 1 : 0);
      expect((await command({ action: "submit", token, version: "v1", answers: { overall: 4 } })).body.state).not.toBe("submitted");
    }
  });
  it("inspects a private invitation without consuming it or returning identity", async () => {
    const { token, survey, invitation } = await fixture.invitation();
    for (let i = 0; i < 2; i++) {
      const result = await command({ action: "inspect", token });
      expect(result.body).toEqual({ state: "ready", survey: { title: survey.title, version: "v1", closesAt: survey.closes_at, sessions: [{ id: "synthetic-session", title: "Synthetic session" }] } });
    }
    expect((await fixture.pb.collection("feedback_invitations").getOne(invitation.id)).used).toBe(false);
    expect((await fixture.pb.collection("feedback_responses").getList(1, 1, { filter: `survey = '${survey.id}'` })).totalItems).toBe(0);
  });
});

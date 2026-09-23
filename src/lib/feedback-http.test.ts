import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { handleFeedbackRequest } from "./feedback-http";
import { startFeedbackPocketBase, type FeedbackPocketBaseFixture } from "./feedback-pocketbase-test-helper";
import { createServer } from "node:http";

describe("public feedback HTTP boundary", () => {
  let fixture: FeedbackPocketBaseFixture;
  beforeAll(async () => { fixture = await startFeedbackPocketBase(); }, 20_000);
  afterAll(async () => { await fixture?.cleanup(); });
  function request(body: unknown, headers: Record<string, string> = {}) {
    return new Request("https://wts.test/api/feedback", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://wts.test", ...headers }, body: JSON.stringify(body) });
  }
  it("accepts no-login commands, ignores unrelated auth cookies, and sets privacy headers", async () => {
    const { token } = await fixture.invitation();
    const inspected = await handleFeedbackRequest(request({ action: "inspect", token }, { Cookie: "pb_auth=unrelated; analytics=secret", Authorization: "Bearer unrelated-account" }), fixture.baseUrl);
    expect((await inspected.json()).state).toBe("ready");
    expect(inspected.headers.get("cache-control")).toBe("no-store");
    expect(inspected.headers.get("referrer-policy")).toBe("no-referrer");
    expect(inspected.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(inspected.headers.has("set-cookie")).toBe(false);
    expect(await (await handleFeedbackRequest(request({ action: "submit", token, version: "v1", answers: { overall: 3 } }), fixture.baseUrl)).json()).toEqual({ state: "submitted" });
    expect(await (await handleFeedbackRequest(request({ action: "inspect", token }), fixture.baseUrl)).json()).toEqual({ state: "used" });
  });
  it("rejects GET, cross-origin and origin-less requests without consuming a link", async () => {
    const { token, invitation } = await fixture.invitation();
    for (const req of [new Request("https://wts.test/api/feedback"), request({ action: "inspect", token }, { Origin: "https://evil.test" }), request({ action: "inspect", token }, { Origin: "" }), request({ action: "inspect", token }, { "Sec-Fetch-Site": "cross-site" })]) {
      const response = await handleFeedbackRequest(req, fixture.baseUrl);
      expect(response.status).toBe(req.method === "GET" ? 405 : 403);
      expect(await response.json()).toEqual({ state: "invalid" });
    }
    expect((await fixture.pb.collection("feedback_invitations").getOne(invitation.id)).used).toBe(false);
  });
  it("forwards only capability JSON, never WTS auth/cookies/origin/IP, and redacts upstream errors", async () => {
    const { token } = await fixture.invitation();
    const captured: { path?: string; headers: Record<string, unknown>; body: unknown }[] = [];
    let mode = 0;
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      captured.push({ path: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
      res.writeHead(mode === 1 ? 500 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(mode === 0 ? { state: "used" } : mode === 1 ? { secret: "upstream-request-and-token" } : { state: "used", answers: { secret: "private-response" } }));
    });
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    try {
      const address = upstream.address();
      if (!address || typeof address === "string") throw new Error("Missing fixture port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      for (mode = 0; mode < 3; mode++) {
        const response = await handleFeedbackRequest(request({ action: "inspect", token }, { Cookie: "pb_auth=private", Authorization: "Bearer private", "X-Forwarded-For": "192.0.2.12" }), baseUrl);
        expect(await response.json()).toEqual({ state: mode === 0 ? "used" : "unavailable" });
        expect(response.status).toBe(mode === 0 ? 200 : 503);
      }
      for (const received of captured) {
        expect(received.path).toBe("/api/wts/feedback");
        expect(received.body).toEqual({ action: "inspect", token });
        for (const key of ["cookie", "authorization", "origin", "x-forwarded-for", "x-real-ip"]) expect(received.headers[key]).toBeUndefined();
      }
    } finally { await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve())); }
  });
  it.each(["界", "\u0000"])("stores the full 200-session contract with maximum-length Unicode/escaped comments (%j)", async character => {
    const sessions = Array.from({ length: 200 }, (_, i) => ({ id: `session-${i}`, title: `Session ${i}` }));
    const { token, survey } = await fixture.invitation({ surveyFields: { sessions } });
    const comment = character.repeat(2000);
    const answers = { overall: 5, keep: comment, change: comment, more: ["other"], moreOther: character.repeat(500), sessions: sessions.map(s => ({ sessionId: s.id, usefulness: 5, comment })) };
    const command = { action: "submit", token, version: "v1", answers };
    expect(Buffer.byteLength(JSON.stringify(command))).toBeGreaterThan(65536);
    const response = await handleFeedbackRequest(request(command), fixture.baseUrl);
    expect(await response.json()).toEqual({ state: "submitted" });
    const rows = await fixture.pb.collection("feedback_responses").getFullList({ filter: `survey = '${survey.id}'` });
    expect(rows).toHaveLength(1);
    expect(rows[0].answers.sessions).toEqual(answers.sessions);
    expect(rows[0].answers.keep).toBe(comment);
  });
  it("bounds streaming bodies without trusting Content-Length and cancels excess data", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(16_384)); },
      cancel() { canceled = true; },
    });
    const init = { method: "POST", headers: { Origin: "https://wts.test", "Content-Type": "application/json", "Content-Length": "1" }, body: stream, duplex: "half" };
    const response = await handleFeedbackRequest(new Request("https://wts.test/api/feedback", init), fixture.baseUrl);
    expect(response.status).toBe(413);
    expect(canceled).toBe(true);
  });
  it("rejects malformed, identity-injected and oversized bodies with redacted output", async () => {
    const { token } = await fixture.invitation();
    for (const body of [null, [], {}, { action: "inspect", token: "bad" }, { action: "inspect", token, email: "private@example.test" }, { action: "submit", token, version: "v1", answers: { overall: 4 }, user: "private-id" }]) {
      const response = await handleFeedbackRequest(request(body), fixture.baseUrl);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ state: "invalid" });
    }
    const tooLarge = await handleFeedbackRequest(request({ action: "submit", token, version: "v1", answers: { overall: 4, keep: "x".repeat(4 * 1024 * 1024 + 1) } }), fixture.baseUrl);
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ state: "invalid_answers" });
    const notJson = await handleFeedbackRequest(request({ action: "inspect", token }, { "Content-Type": "text/plain" }), fixture.baseUrl);
    expect(notJson.status).toBe(415);
  });
});

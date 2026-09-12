import { describe, expect, it } from "vite-plus/test";
import { handleLiveQaProgramme, handleLiveQaRequest } from "~/lib/live-qa-http";
import { startLiveQaPocketBase } from "~/lib/live-qa-pocketbase-test-helper";

const origin = "https://wts.example.test";
function request(body = "{}", headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/live-qa`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body });
}

describe("live Q&A HTTP boundary", () => {
  it("serves the public stage programme without accepting cookie authority", { timeout: 30_000 }, async () => {
    const fixture = await startLiveQaPocketBase();
    try {
      const talk = await fixture.session();
      const result = await handleLiveQaProgramme(new Request(`${origin}/api/live-qa`, { headers: { cookie: "pb_auth=untrusted" } }), fixture.baseUrl);
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("private, no-store");
      const data = await result.json();
      expect(data.day.key).toBe("main-day");
      expect(data.stages.flatMap((stage: { sessions: { slug: string }[] }) => stage.sessions).some((session: { slug: string }) => session.slug === talk.slug)).toBe(true);
      expect(JSON.stringify(data)).not.toContain("questions");
      expect(JSON.stringify(data)).not.toContain("author");
    } finally { await fixture.cleanup(); }
  });

  it("denies cross-origin commands before contacting PocketBase and never caches private responses", async () => {
    const result = await handleLiveQaRequest(request("{}", { origin: "https://foreign.example" }));
    expect(result.status).toBe(403);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ error: "Q&A access denied." });
  });

  it("requires a valid session cookie and JSON without exposing private data", async () => {
    const anonymous = await handleLiveQaRequest(request());
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "Log in to use Q&A." });
    const malformed = await handleLiveQaRequest(request("{}", { cookie: "pb_auth=malformed" }));
    expect(malformed.status).toBe(401);
    const text = await handleLiveQaRequest(request("{}", { "content-type": "text/plain" }));
    expect(text.status).toBe(415);
    const get = await handleLiveQaRequest(new Request(`${origin}/api/live-qa`));
    expect(get.status).toBe(403);
  });

  it("bounds the streamed JSON command before upstream authentication", async () => {
    const token = `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
    const cookie = `pb_auth=${encodeURIComponent(JSON.stringify({ token, record: null }))}`;
    const oversized = await handleLiveQaRequest(request(JSON.stringify({ body: "x".repeat(9000) }), { cookie }));
    expect(oversized.status).toBe(413);
    const malformed = await handleLiveQaRequest(request("{", { cookie }));
    expect(malformed.status).toBe(400);
  });
});

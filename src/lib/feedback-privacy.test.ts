import { describe, expect, it } from "vite-plus/test";
import { isFeedbackPath, protectFeedbackResponse } from "./feedback-privacy";

describe("feedback document privacy boundary", () => {
  it("protects all route aliases without classifying unrelated pages", () => {
    for (const path of ["/feedback", "/feedback/", "/FEEDBACK", "/%66eedback", "/api/feedback", "/API/FEEDBACK/"]) expect(isFeedbackPath(path)).toBe(true);
    for (const path of ["/", "/feedback-other", "/sessions/feedback", "/api/feedback-other"]) expect(isFeedbackPath(path)).toBe(false);
  });
  it("prevents caching, indexing, embedding and third-party execution", async () => {
    const response = protectFeedbackResponse(new Response("Private survey", { status: 403, headers: { "Cache-Control": "public", "Set-Cookie": "unexpected=identity" } }));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Private survey");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.has("set-cookie")).toBe(false);
  });
});

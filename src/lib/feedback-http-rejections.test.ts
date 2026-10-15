import { describe, expect, it } from "vite-plus/test";
import { handleFeedbackRequest } from "./feedback-http";

const token = "a".repeat(43);

function post(body: BodyInit | null, contentType: string | null) {
  const headers: Record<string, string> = { Origin: "https://wts.test" };
  if (contentType !== null) headers["Content-Type"] = contentType;
  return new Request("https://wts.test/api/feedback", { method: "POST", headers, body });
}

async function outcome(request: Request) {
  const response = await handleFeedbackRequest(request, "http://127.0.0.1:9");
  return [response.status, await response.json()];
}

describe("public feedback HTTP request rejections", () => {
  it.each<[string, BodyInit | null, string | null, number, unknown]>([
    ["a missing content type", JSON.stringify({ action: "inspect", token }), null, 415, { state: "invalid" }],
    ["a non-JSON media type", JSON.stringify({ action: "inspect", token }), "text/plain", 415, { state: "invalid" }],
    ["an empty JSON body", null, "Application/JSON; charset=utf-8", 400, { state: "invalid" }],
    ["malformed JSON", "{", "application/json", 400, { state: "invalid" }],
    ["an unknown command", JSON.stringify({ action: "delete", token }), "application/json", 400, { state: "invalid" }],
  ])("rejects %s", async (_name, body, contentType, status, payload) => {
    await expect(outcome(post(body, contentType))).resolves.toEqual([status, payload]);
  });
});

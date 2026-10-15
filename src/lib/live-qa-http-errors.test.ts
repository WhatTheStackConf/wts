import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createServer, type Server } from "node:http";
import { handleLiveQaRequest } from "~/lib/live-qa-http";

const origin = "https://wts.example.test";
const token = `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
const cookie = `pb_auth=${encodeURIComponent(JSON.stringify({ token, record: null }))}`;

type Upstream = { refresh: [number, unknown]; command: [number, unknown] };
let upstream: Upstream;
let server: Server;
let baseUrl = "";
const received: string[] = [];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push(`${req.method} ${req.url} ${Buffer.concat(chunks).toString()}`);
    const [status, body] = req.url?.startsWith("/api/collections/users/auth-refresh") ? upstream.refresh : upstream.command;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing upstream port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const verifiedUser = { token, record: { id: "user-1", role: "user", verified: true } };

async function call(next: Upstream, qaUser = "user-1", body: string | null = JSON.stringify({ operation: "ask" })) {
  upstream = next;
  received.length = 0;
  const headers: Record<string, string> = { origin, cookie, "content-type": "application/json", "x-wts-qa-user": qaUser };
  const result = await handleLiveQaRequest(new Request(`${origin}/api/live-qa`, { method: "POST", headers, body }), baseUrl);
  return [result.status, await result.json()];
}

describe("live Q&A HTTP upstream failures", () => {
  it.each<[string, [number, unknown], string, unknown[]]>([
    ["a rejected session", [401, { message: "no" }], "user-1", [401, { error: "Log in to use Q&A." }]],
    ["a forbidden session", [403, { message: "no" }], "user-1", [401, { error: "Log in to use Q&A." }]],
    ["an unavailable session service", [500, { message: "boom" }], "user-1", [503, { error: "Q&A unavailable. Try again." }]],
    ["an unsupported role", [200, { token, record: { id: "user-1", role: "guest", verified: true } }], "user-1", [401, { error: "Log in to use Q&A." }]],
    ["an unverified account", [200, { token, record: { id: "user-1", role: "user", verified: false } }], "user-1", [401, { error: "Log in to use Q&A." }]],
    ["a different panel account", [200, verifiedUser], "user-2", [403, { error: "Your account changed. Reload this page before using Q&A." }]],
  ])("maps %s", async (_name, refresh, qaUser, expected) => {
    await expect(call({ refresh, command: [200, { ok: true }] }, qaUser)).resolves.toEqual(expected);
    expect(received.some((line) => line.startsWith("POST /api/wts/live-qa"))).toBe(false);
  });

  it.each<[number, unknown[]]>([
    [400, [400, { error: "Invalid Q&A command. Questions must contain 1–1000 characters." }]],
    [401, [401, { error: "Log in to use Q&A." }]],
    [403, [403, { error: "Q&A access denied." }]],
    [404, [404, { error: "This talk or question is unavailable." }]],
    [409, [409, { error: "Questions are closed, or this request conflicts with an earlier submission. Refresh and try again." }]],
    [429, [429, { error: "Please wait 10 seconds before asking another question." }]],
    [418, [503, { error: "Q&A unavailable. Try again." }]],
  ])("maps command status %i", async (status, expected) => {
    await expect(call({ refresh: [200, verifiedUser], command: [status, { message: "private diagnostics" }] })).resolves.toEqual(expected);
  });

  it("forwards the parsed command and returns the hook result", async () => {
    await expect(call({ refresh: [200, verifiedUser], command: [200, { questions: [] }] })).resolves.toEqual([200, { questions: [] }]);
    expect(received.at(-1)).toBe('POST /api/wts/live-qa {"operation":"ask"}');
  });

  it("rejects an empty command body", async () => {
    await expect(call({ refresh: [200, verifiedUser], command: [200, {}] }, "user-1", null))
      .resolves.toEqual([400, { error: "Invalid Q&A command." }]);
    expect(received).toEqual([]);
  });
});

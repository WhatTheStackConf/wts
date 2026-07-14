import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createConferenceGuide,
  ProgrammeUnavailableError,
} from "~/lib/conference-guide";
import { conferenceGuideContent } from "~/lib/conference-guide-content";

const guide = vi.hoisted(() => ({
  getIndex: vi.fn(async () => ({
    metadata: {
      schema_version: "1",
      content_version: "2026-07-14",
      programme_version: "sha256:programme",
      generated_at: "2026-07-14T18:00:00.000Z",
      time_zone: "Europe/Skopje",
      canonical_url: "https://wts.sh/mcp",
    },
    programme_status: "available",
    logistics: { main_venue: { status: "not_announced" } },
    programme: { sessions: [{ slug: "safe-systems" }] },
  })),
  getAgenda: vi.fn(async () => ({
    metadata: { content_version: "2026-07-14", programme_version: "sha256:programme" },
    days: [{ key: "conference-day" }],
  })),
  getSession: vi.fn(async (slug: string) => slug === "safe-systems" ? ({
    metadata: { content_version: "2026-07-14", programme_version: "sha256:programme" },
    slug,
    title: "Safe Systems",
  }) : null),
  getSpeaker: vi.fn(async (slug: string) => slug === "ada-example" ? ({
    metadata: { content_version: "2026-07-14", programme_version: "sha256:programme" },
    slug,
    display_name: "Ada Example",
  }) : null),
  getPartners: vi.fn(async () => ({
    metadata: { content_version: "2026-07-14", programme_version: "sha256:programme" },
    groups: [{ key: "supporters", partners: [{ name: "Example Partner" }] }],
  })),
}));

vi.mock("~/lib/conference-guide-data", () => ({ publicConferenceGuide: guide }));

import { DELETE, GET, OPTIONS, POST } from "~/routes/api/mcp/public";
import { handlePublicMcpRequest } from "~/lib/mcp-public-http";
import { resetPublicMcpProtection } from "~/lib/mcp-public-protection";

const MCP_URL = new URL("https://wts.sh/api/mcp/public");

interface TestRouteEvent {
  request: Request;
  clientAddress?: string;
}

async function dispatch(request: Request, clientAddress = "198.51.100.10") {
  const event: TestRouteEvent = {
    request,
    clientAddress,
  };
  if (request.method === "POST") return POST(event);
  if (request.method === "GET") return GET(event);
  if (request.method === "DELETE") return DELETE(event);
  if (request.method === "OPTIONS") return OPTIONS(event);
  return new Response(null, { status: 405 });
}

async function openClient(
  origin?: string,
  requestDispatcher: (request: Request) => Promise<Response> = dispatch,
) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  const transport = new StreamableHTTPClientTransport(MCP_URL, {
    requestInit: { headers },
    fetch: async (input, init) => requestDispatcher(new Request(input, init)),
  });
  const client = new Client({ name: "wts-public-contract", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function initializeRequest(headers: HeadersInit = {}) {
  return new Request(MCP_URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "raw-public-contract", version: "1.0.0" },
      },
    }),
  });
}

function resourceJson(result: unknown) {
  const contents = (result as { contents?: Array<{ text?: string }> }).contents;
  return JSON.parse(contents?.[0]?.text || "null") as Record<string, unknown>;
}

describe("public Conference Guide MCP contract", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_SITE_URL", "https://wts.sh");
    vi.stubEnv("MCP_ALLOWED_ORIGINS", "https://configured-client.example");
    vi.stubEnv("MCP_PUBLIC_BURST_LIMIT", "120");
    vi.stubEnv("MCP_PUBLIC_GLOBAL_LIMIT", "1200");
    vi.stubEnv("MCP_PUBLIC_CONCURRENCY_LIMIT", "48");
    resetPublicMcpProtection();
    for (const mock of Object.values(guide)) mock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("discovers only the guide index, Agenda, Partner resources, and slug templates", async () => {
    const client = await openClient();
    try {
      const resources = await client.listResources();
      const templates = await client.listResourceTemplates();

      expect(resources.resources.map((resource) => resource.uri)).toEqual([
        "wts://conference-guide/index",
        "wts://conference-guide/agenda",
        "wts://conference-guide/partners",
      ]);
      expect(templates.resourceTemplates.map((template) => template.uriTemplate)).toEqual([
        "wts://conference-guide/sessions/{slug}",
        "wts://conference-guide/speakers/{slug}",
      ]);
      await expect(client.listTools()).rejects.toMatchObject({ code: -32601 });
      await expect(client.listPrompts()).rejects.toMatchObject({ code: -32601 });
    } finally {
      await client.close();
    }
  });

  it("reads every documented anonymous resource through the official client", async () => {
    const client = await openClient();
    try {
      const index = resourceJson(await client.readResource({ uri: "wts://conference-guide/index" }));
      const agenda = resourceJson(await client.readResource({ uri: "wts://conference-guide/agenda" }));
      const session = resourceJson(await client.readResource({ uri: "wts://conference-guide/sessions/safe-systems" }));
      const speaker = resourceJson(await client.readResource({ uri: "wts://conference-guide/speakers/ada-example" }));
      const partners = resourceJson(await client.readResource({ uri: "wts://conference-guide/partners" }));

      expect(index).toMatchObject({
        programme_status: "available",
        logistics: { main_venue: { status: "not_announced" } },
      });
      expect(agenda).toMatchObject({ days: [{ key: "conference-day" }] });
      expect(session).toMatchObject({ slug: "safe-systems", title: "Safe Systems" });
      expect(speaker).toMatchObject({ slug: "ada-example", display_name: "Ada Example" });
      expect(partners).toMatchObject({ groups: [{ key: "supporters" }] });
      expect(guide.getSession).toHaveBeenCalledWith("safe-systems");
      expect(guide.getSpeaker).toHaveBeenCalledWith("ada-example");
    } finally {
      await client.close();
    }
  });

  it("preserves the strict Guide allowlist and complete metadata at the HTTP contract", async () => {
    const strictGuide = createConferenceGuide({
      content: conferenceGuideContent,
      canonicalOrigin: "https://wts.sh",
      now: () => new Date("2026-07-14T18:00:00.000Z"),
      loadPublishedData: async () => ({
        agenda: {
          days: [{
            key: "conference-day",
            localDate: "2026-09-19",
            title: "Conference Day",
            slots: [{
              kind: "session",
              startAt: "2026-09-19T08:00:00.000Z",
              endAt: "2026-09-19T08:35:00.000Z",
              track: { key: "main", name: "Main" },
              session: { slug: "safe-systems", title: "Safe Systems" },
            }],
          }],
        },
        sessions: [{
          slug: "safe-systems",
          title: "Safe Systems",
          abstract: "<p>Public abstract.</p>",
          speakers: [{
            slug: "ada-example",
            displayName: "Ada Example",
            affiliation: "Example Labs",
            photoUrl: "https://pb.example/private-speaker-id/photo.webp",
            sessionCount: 1,
            origin: "cfp",
          } as never],
          relatedSessions: [],
          id: "private-session-id",
          cfp_submission_id: "private-submission-id",
          reviews: ["private-review"],
          created: "private-created-timestamp",
        } as never],
        speakers: [{
          slug: "ada-example",
          displayName: "Ada Example",
          affiliation: "Example Labs",
          photoUrl: "https://pb.example/private-speaker-id/photo.webp",
          sessionCount: 1,
          bio: "<p>Public bio.</p>",
          socialHandles: [],
          sessions: [{ slug: "safe-systems", title: "Safe Systems" }],
          origin: "cfp",
        } as never],
        partnerGroups: [{
          id: "supporters",
          title: "Supporters",
          kind: "partner",
          type: "supporter",
          partners: [{
            name: "Example Partner",
            logoUrl: "https://pb.example/private-partner-id/logo.svg",
            type: "supporter",
            notes: "Private Partner Note",
            admin_actions: ["Private Admin Action"],
          } as never],
        }],
      }),
    });
    const strictDispatch = (request: Request) => handlePublicMcpRequest(
      { request, clientAddress: "198.51.100.30" },
      strictGuide,
    );
    const client = await openClient(undefined, strictDispatch);
    try {
      const values = [
        resourceJson(await client.readResource({ uri: "wts://conference-guide/index" })),
        resourceJson(await client.readResource({ uri: "wts://conference-guide/agenda" })),
        resourceJson(await client.readResource({ uri: "wts://conference-guide/sessions/safe-systems" })),
        resourceJson(await client.readResource({ uri: "wts://conference-guide/speakers/ada-example" })),
        resourceJson(await client.readResource({ uri: "wts://conference-guide/partners" })),
      ];
      for (const value of values) {
        expect(value.metadata).toMatchObject({
          schema_version: "1",
          content_version: "2026-07-14",
          programme_version: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          generated_at: "2026-07-14T18:00:00.000Z",
          time_zone: "Europe/Skopje",
          canonical_url: expect.stringMatching(/^https:\/\/wts\.sh\//),
        });
      }
      const serialized = JSON.stringify(values);
      for (const forbidden of [
        "private-session-id",
        "private-speaker-id",
        "private-partner-id",
        "private-submission-id",
        "private-review",
        "private-created-timestamp",
        "Private Partner Note",
        "Private Admin Action",
        '"published"',
        '"origin"',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(serialized).not.toContain("<p>");
    } finally {
      await client.close();
    }
  });

  it("rejects invalid slugs, missing Published records, and programme outages clearly", async () => {
    const client = await openClient();
    try {
      await expect(client.readResource({ uri: "wts://conference-guide/sessions/not%2Fsafe" }))
        .rejects.toMatchObject({ code: -32602, message: expect.stringContaining("invalid_slug") });
      await expect(client.readResource({ uri: "wts://conference-guide/sessions/missing" }))
        .rejects.toMatchObject({ code: -32602, message: expect.stringContaining("resource_not_found") });

      guide.getAgenda.mockRejectedValueOnce(new ProgrammeUnavailableError());
      await expect(client.readResource({ uri: "wts://conference-guide/agenda" }))
        .rejects.toMatchObject({ code: -32603, message: expect.stringContaining("programme_unavailable") });
    } finally {
      await client.close();
    }
  });

  it("rejects every supplied Authorization header before MCP dispatch", async () => {
    for (const authorization of ["", "Basic abc", "Bearer admin-secret"]) {
      const response = await dispatch(initializeRequest({ Authorization: authorization }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "Authorization is not accepted by the anonymous public MCP endpoint.",
      });
    }
    expect(guide.getIndex).not.toHaveBeenCalled();
  });

  it("reuses the hardened no-Origin and allowlist Origin policy", async () => {
    const native = await OPTIONS({ request: new Request(MCP_URL, { method: "OPTIONS" }) });
    expect(native.status).toBe(204);
    expect(native.headers.get("Access-Control-Allow-Origin")).toBeNull();

    for (const origin of ["https://wts.sh", "https://configured-client.example"]) {
      const response = await OPTIONS({
        request: new Request(MCP_URL, { method: "OPTIONS", headers: { Origin: origin } }),
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    }

    const rejected = await dispatch(initializeRequest({ Origin: "https://attacker.example" }));
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("returns 429 with Retry-After for per-IP bursts and global capacity", async () => {
    vi.stubEnv("MCP_PUBLIC_BURST_LIMIT", "1");
    const first = await dispatch(initializeRequest(), "198.51.100.20");
    const burst = await dispatch(initializeRequest(), "198.51.100.20");
    expect(first.status).toBe(200);
    expect(burst.status).toBe(429);
    expect(burst.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(burst.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");

    resetPublicMcpProtection();
    vi.stubEnv("MCP_PUBLIC_BURST_LIMIT", "10");
    vi.stubEnv("MCP_PUBLIC_GLOBAL_LIMIT", "1");
    await dispatch(initializeRequest(), "198.51.100.21");
    const global = await dispatch(initializeRequest(), "198.51.100.22");
    expect(global.status).toBe(429);
    expect(global.headers.get("Retry-After")).toMatch(/^\d+$/);

    resetPublicMcpProtection();
    vi.stubEnv("MCP_PUBLIC_BURST_LIMIT", "1");
    vi.stubEnv("MCP_PUBLIC_GLOBAL_LIMIT", "10");
    vi.stubEnv("MCP_TRUST_PROXY", "true");
    const proxyHeaders = { "X-Forwarded-For": "203.0.113.10" };
    await dispatch(initializeRequest(proxyHeaders), "10.0.0.1");
    const proxyBurst = await dispatch(initializeRequest(proxyHeaders), "10.0.0.2");
    expect(proxyBurst.status).toBe(429);
  });

  it("bounds request bodies and JSON-RPC batches before dispatch", async () => {
    const oversized = await dispatch(new Request(MCP_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payload: "x".repeat(65 * 1_024) }),
    }), "198.51.100.40");
    expect(oversized.status).toBe(413);

    resetPublicMcpProtection();
    const batch = Array.from({ length: 9 }, (_, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: "resources/list",
      params: {},
    }));
    const oversizedBatch = await dispatch(new Request(MCP_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    }), "198.51.100.41");
    expect(oversizedBatch.status).toBe(400);
    await expect(oversizedBatch.json()).resolves.toMatchObject({
      error: "Public MCP JSON-RPC batch is too large.",
    });
  });

  it("uses explicit stateless method behavior without accepting credentials", async () => {
    for (const method of ["GET", "DELETE"] as const) {
      const request = new Request(MCP_URL, { method });
      const response = method === "GET" ? await GET({ request }) : await DELETE({ request });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    }
    const authorizedGet = await GET({
      request: new Request(MCP_URL, { headers: { Authorization: "Bearer secret" } }),
    });
    expect(authorizedGet.status).toBe(400);
  });
});

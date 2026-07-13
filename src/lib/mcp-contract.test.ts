import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpTokenMaterial } from "~/lib/mcp-token-utils";

const adminService = vi.hoisted(() => ({
  fetchAllRecords: vi.fn(),
  updateRecord: vi.fn(),
}));

const programmeData = vi.hoisted(() => ({
  fetchMcpProgramSnapshot: vi.fn(async () => ({ snapshot: true })),
  fetchMcpProposalContext: vi.fn(async () => ({ submission_id: "submission-1" })),
  fetchMcpProposals: vi.fn(async () => []),
  fetchMcpSessions: vi.fn(async () => []),
  fetchMcpSpeakers: vi.fn(async () => []),
}));

vi.mock("~/lib/pocketbase-admin-service", () => ({
  getAdminPB: () => adminService,
}));

vi.mock("~/lib/mcp-program-data", () => programmeData);

import { DELETE, GET, OPTIONS, POST } from "~/routes/api/mcp";

const MCP_URL = new URL("https://wts.sh/api/mcp");
const PREVIOUS_TOOL_NAMES = [
  "get_program_snapshot",
  "list_sessions",
  "list_speakers",
  "list_proposals",
  "get_proposal_context",
] as const;

let currentRecord: Record<string, unknown>;
let ownerRole = "admin";

function issueToken(scopes: string[], overrides: Record<string, unknown> = {}) {
  const material = createMcpTokenMaterial();
  currentRecord = {
    id: "mcp-token-record",
    name: "MCP test client",
    token_id: material.tokenId,
    token_prefix: material.tokenPrefix,
    secret_hash: material.secretHash,
    scopes,
    created_by: "admin-user",
    expires_at: "2030-01-01 00:00:00.000Z",
    ...overrides,
  };
  return material.token;
}

async function dispatch(request: Request) {
  const event = { request };
  if (request.method === "POST") return POST(event);
  if (request.method === "GET") return GET(event);
  if (request.method === "DELETE") return DELETE(event);
  if (request.method === "OPTIONS") return OPTIONS(event);
  return new Response(null, { status: 405 });
}

async function openClient(token: string, origin?: string) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (origin) headers.set("Origin", origin);
  const transport = new StreamableHTTPClientTransport(MCP_URL, {
    requestInit: { headers },
    fetch: async (input, init) => dispatch(new Request(input, init)),
  });
  const client = new Client({ name: "wts-contract-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function postRequest(headers: HeadersInit = {}) {
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
        clientInfo: { name: "raw-contract-test", version: "1.0.0" },
      },
    }),
  });
}

describe("administrative MCP protocol contract", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_SITE_URL", "https://wts.sh");
    vi.stubEnv("MCP_ALLOWED_ORIGINS", "https://configured-client.example");
    currentRecord = {};
    ownerRole = "admin";
    adminService.fetchAllRecords.mockReset();
    adminService.updateRecord.mockReset();
    adminService.updateRecord.mockResolvedValue({});
    adminService.fetchAllRecords.mockImplementation((collection: string) => {
      if (collection === "mcp_tokens") return Promise.resolve([currentRecord]);
      if (collection === "users") {
        return Promise.resolve([{ id: "admin-user", role: ownerRole }]);
      }
      return Promise.resolve([]);
    });
    for (const mock of Object.values(programmeData)) mock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["programme", ["programme:read"], ["list_sessions", "list_speakers"]],
    ["CFP", ["cfp:read"], ["list_proposals", "get_proposal_context"]],
    ["aggregate", ["programme:read", "cfp:read"], PREVIOUS_TOOL_NAMES],
  ])("filters %s tool discovery by current scopes", async (_label, scopes, expectedTools) => {
    const client = await openClient(issueToken(scopes));
    try {
      const result = await client.listTools();
      expect(result.tools.map((tool) => tool.name)).toEqual(expectedTools);
    } finally {
      await client.close();
    }
  });

  it("preserves every existing tool name, description, and input schema", async () => {
    const client = await openClient(issueToken(["programme:read", "cfp:read"]));
    try {
      const result = await client.listTools();
      const tools = Object.fromEntries(result.tools.map((tool) => [tool.name, tool]));

      expect(tools.get_program_snapshot).toMatchObject({
        title: "Get Program Snapshot",
        description:
          "Return Sessions, Speakers, CFP Submissions, and aggregate counts for programme/stage design.",
        inputSchema: { type: "object", properties: {} },
      });
      expect(tools.list_sessions).toMatchObject({
        title: "List Sessions",
        description:
          "Return draft and published programme Sessions, optionally filtered by publication, canonical Track, or location.",
        inputSchema: {
          type: "object",
          properties: {
            published: { type: "boolean" },
            track: { type: "string" },
            room: { type: "string" },
          },
        },
      });
      expect(tools.list_speakers).toMatchObject({
        title: "List Speakers",
        description:
          "Return draft and published public Speaker profiles, optionally filtered by publication or origin.",
        inputSchema: {
          type: "object",
          properties: {
            published: { type: "boolean" },
            origin: { enum: ["cfp", "invite"] },
          },
        },
      });
      expect(tools.list_proposals).toMatchObject({
        title: "List Proposals",
        description:
          "Return CFP Submissions with applicant context and review score summaries for programme acceptance decisions.",
        inputSchema: {
          type: "object",
          properties: { status: { enum: ["pending", "accepted", "rejected"] } },
        },
      });
      expect(tools.get_proposal_context).toMatchObject({
        title: "Get Proposal Context",
        description:
          "Return one CFP Submission with applicant context and review summary for acceptance decisions.",
        inputSchema: {
          type: "object",
          required: ["submission_id"],
          properties: { submission_id: { type: "string", pattern: "^[A-Za-z0-9_-]+$" } },
        },
      });
    } finally {
      await client.close();
    }
  });

  it("denies a direct call when discovery omitted the tool", async () => {
    const client = await openClient(issueToken(["programme:read"]));
    try {
      await expect(
        client.callTool({ name: "list_proposals", arguments: {} }),
      ).rejects.toMatchObject({ code: 403 });
      expect(programmeData.fetchMcpProposals).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("revalidates the token owner's admin role for each protocol request", async () => {
    const client = await openClient(issueToken(["programme:read"]));
    try {
      ownerRole = "reviewer";
      await expect(client.listTools()).rejects.toMatchObject({ code: 403 });
    } finally {
      await client.close();
    }
  });

  it("denies an unauthorized tool call inside a JSON-RPC batch", async () => {
    const token = issueToken(["programme:read"]);
    const request = new Request(MCP_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "list_proposals", arguments: {} },
        },
      ]),
    });

    const response = await POST({ request });

    expect(response.status).toBe(403);
    expect(programmeData.fetchMcpProposals).not.toHaveBeenCalled();
  });

  it("lets a migrated legacy token call every tool it could call before", async () => {
    const client = await openClient(issueToken(["programme:read", "cfp:read"]));
    try {
      const calls = [
        ["get_program_snapshot", {}],
        ["list_sessions", {}],
        ["list_speakers", {}],
        ["list_proposals", {}],
        ["get_proposal_context", { submission_id: "submission-1" }],
      ] as const;

      for (const [name, args] of calls) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).not.toBe(true);
      }

      expect(programmeData.fetchMcpProgramSnapshot).toHaveBeenCalledOnce();
      expect(programmeData.fetchMcpSessions).toHaveBeenCalledOnce();
      expect(programmeData.fetchMcpSpeakers).toHaveBeenCalledOnce();
      expect(programmeData.fetchMcpProposals).toHaveBeenCalledOnce();
      expect(programmeData.fetchMcpProposalContext).toHaveBeenCalledWith("submission-1");
    } finally {
      await client.close();
    }
  });

  it("returns 401 for missing, malformed, expired, and revoked credentials", async () => {
    const missing = await POST({ request: postRequest() });
    expect(missing.status).toBe(401);

    const malformed = await POST({
      request: postRequest({ Authorization: "Bearer invalid" }),
    });
    expect(malformed.status).toBe(401);

    const expiredToken = issueToken(["programme:read"], {
      expires_at: "2020-01-01 00:00:00.000Z",
    });
    const expired = await POST({
      request: postRequest({ Authorization: `Bearer ${expiredToken}` }),
    });
    expect(expired.status).toBe(401);

    const revokedToken = issueToken(["programme:read"], {
      revoked_at: "2026-01-01 00:00:00.000Z",
    });
    const revoked = await POST({
      request: postRequest({ Authorization: `Bearer ${revokedToken}` }),
    });
    expect(revoked.status).toBe(401);
  });

  it("returns 403 for a valid token without authority and never falls back", async () => {
    const unscopedToken = issueToken([]);
    const unscoped = await POST({
      request: postRequest({ Authorization: `Bearer ${unscopedToken}` }),
    });
    expect(unscoped.status).toBe(403);

    ownerRole = "reviewer";
    const demotedToken = issueToken(["programme:read", "cfp:read"]);
    const demoted = await POST({
      request: postRequest({ Authorization: `Bearer ${demotedToken}` }),
    });
    expect(demoted.status).toBe(403);

    expect(programmeData.fetchMcpSessions).not.toHaveBeenCalled();
    expect(programmeData.fetchMcpProposals).not.toHaveBeenCalled();
  });

  it("accepts no Origin, the WTS Origin, and configured Origins with matching CORS", async () => {
    const native = await OPTIONS({
      request: new Request(MCP_URL, { method: "OPTIONS" }),
    });
    expect(native.status).toBe(204);
    expect(native.headers.get("Access-Control-Allow-Origin")).toBeNull();

    for (const origin of ["https://wts.sh", "https://configured-client.example"]) {
      const response = await OPTIONS({
        request: new Request(MCP_URL, { method: "OPTIONS", headers: { Origin: origin } }),
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Vary")).toContain("Origin");
      expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    }

    const unauthorized = await POST({
      request: postRequest({ Origin: "https://configured-client.example" }),
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://configured-client.example",
    );
  });

  it("rejects every other supplied Origin before authentication", async () => {
    for (const origin of ["https://attacker.example", "null"]) {
      const response = await POST({
        request: postRequest({ Origin: origin }),
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(response.headers.get("Vary")).toContain("Origin");
    }
    expect(adminService.fetchAllRecords).not.toHaveBeenCalled();
  });

  it("uses explicit stateless HTTP method behavior", async () => {
    const token = issueToken(["programme:read"]);
    for (const method of ["GET", "DELETE"] as const) {
      const request = new Request(MCP_URL, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      const response = method === "GET" ? await GET({ request }) : await DELETE({ request });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    }
  });
});

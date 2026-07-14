import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpTokenMaterial } from "~/lib/mcp-token-utils";
import { PARTNER_TYPES } from "~/lib/partner-administration";

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

const partnerAdministration = vi.hoisted(() => ({
  listPartners: vi.fn(async () => ({
    success: true,
    data: {
      partners: [{
        id: "partner-1",
        name: "Safe Partner",
        state: "draft",
        type: "supporter",
        logo_present: false,
        updated_at: "2026-07-14 08:00:00.000Z",
        expected_updated_at: "2026-07-14 08:00:00.000Z",
        publication: { ready: false, issues: [{ field: "logo", message: "Upload a logo." }] },
      }],
      duplicate_check: {
        exact_name: "Exact normalized Partner names are blocked.",
        exact_url: "Exact canonical full Partner URLs are blocked.",
        fuzzy: "Similar names warn.",
      },
    },
  })),
  getPartner: vi.fn(async () => ({
    success: true,
    data: {
      partner: {
        id: "partner-1",
        name: "Safe Partner",
        state: "draft",
        type: "supporter",
        logo_present: false,
        updated_at: "2026-07-14 08:00:00.000Z",
        expected_updated_at: "2026-07-14 08:00:00.000Z",
        created_at: "2026-07-14 08:00:00.000Z",
        note_agent_visible: false,
      },
    },
  })),
  createPartnerDraft: vi.fn(async (input: { operation_id: string; name: string }) => ({
    success: true,
    data: {
      partner: {
        id: "partner-created",
        name: input.name,
        state: "draft",
        type: "supporter",
        logo_present: false,
        updated_at: "2026-07-14 08:00:00.000Z",
        expected_updated_at: "2026-07-14 08:00:00.000Z",
      },
      warnings: [],
      publication: { ready: false, issues: [{ field: "logo", message: "Upload a logo." }] },
      action: {
        id: "action-create",
        operation_id: input.operation_id,
        operation_kind: "partner.create",
        status: "applied",
        replayed: false,
      },
    },
  })),
  updatePartnerDraft: vi.fn(async (input: { operation_id: string }) => ({
    success: true,
    data: {
      partner: {
        id: "partner-1",
        name: "Updated Partner",
        state: "draft",
        type: "supporter",
        logo_present: false,
        updated_at: "2026-07-14 09:00:00.000Z",
        expected_updated_at: "2026-07-14 09:00:00.000Z",
      },
      warnings: [],
      publication: { ready: false, issues: [{ field: "logo", message: "Upload a logo." }] },
      action: {
        id: "action-update",
        operation_id: input.operation_id,
        operation_kind: "partner.patch",
        status: "applied",
        replayed: false,
      },
    },
  })),
}));

vi.mock("~/lib/pocketbase-admin-service", () => ({
  getAdminPB: () => adminService,
}));

vi.mock("~/lib/mcp-program-data", () => programmeData);

vi.mock("~/lib/mcp-partner-administration", () => ({
  createMcpPartnerAdministration: () => partnerAdministration,
  mcpPartnerInfrastructureError: () => ({
    success: false,
    error: {
      code: "infrastructure",
      message: "Partner administration is temporarily unavailable.",
      next_step: "Retry later.",
      retryable: true,
    },
  }),
}));

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

function toolText(result: unknown): string {
  const content = (result as { content?: unknown }).content as
    | Array<{ type?: string; text?: string }>
    | undefined;
  return content?.[0]?.type === "text" ? content[0].text || "" : "";
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
    for (const mock of Object.values(partnerAdministration)) mock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["programme", ["programme:read"], ["list_sessions", "list_speakers"]],
    ["CFP", ["cfp:read"], ["list_proposals", "get_proposal_context"]],
    ["Partner read", ["partners:read"], ["list_partners", "get_partner"]],
    ["Partner draft write", ["partners:draft:write"], ["create_partner_draft", "update_partner_draft"]],
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

  it("publishes strict least-privilege Partner tool contracts", async () => {
    const client = await openClient(issueToken(["partners:read", "partners:draft:write"]));
    try {
      const result = await client.listTools();
      const tools = Object.fromEntries(result.tools.map((tool) => [tool.name, tool]));

      expect(Object.keys(tools)).toEqual([
        "list_partners",
        "get_partner",
        "create_partner_draft",
        "update_partner_draft",
      ]);
      expect(tools.list_partners).toMatchObject({
        title: "List Partners",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { state: { enum: ["draft", "published"] }, type: { enum: [...PARTNER_TYPES] } },
        },
        outputSchema: { type: "object", required: ["success"], additionalProperties: false },
      });
      expect(tools.get_partner).toMatchObject({
        title: "Get Partner",
        inputSchema: {
          required: ["partner_id"],
          additionalProperties: false,
        },
      });
      expect(tools.create_partner_draft).toMatchObject({
        title: "Create Partner Draft",
        inputSchema: {
          required: ["operation_id", "name", "type"],
          additionalProperties: false,
        },
      });
      expect(tools.create_partner_draft.inputSchema.properties).not.toHaveProperty("logo");
      expect(tools.create_partner_draft.inputSchema.properties).not.toHaveProperty("published");
      expect(tools.create_partner_draft.inputSchema.properties).not.toHaveProperty("note_agent_visible");
      expect(tools.update_partner_draft).toMatchObject({
        title: "Update Partner Draft",
        inputSchema: {
          required: ["operation_id", "partner_id", "expected_updated_at", "patch"],
          additionalProperties: false,
          properties: {
            patch: { additionalProperties: false },
          },
        },
      });
      expect(tools.update_partner_draft.inputSchema.properties?.patch).not.toHaveProperty("logo");
      expect(Object.keys(tools)).not.toEqual(expect.arrayContaining([
        "publish_partner",
        "delete_partner",
        "upload_partner_logo",
        "approve_partner_note",
      ]));
    } finally {
      await client.close();
    }
  });

  it("returns matching structured content and text fallback with safe actionable errors", async () => {
    const client = await openClient(issueToken(["partners:read"]));
    try {
      const listed = await client.callTool({ name: "list_partners", arguments: {} });
      expect(listed.isError).not.toBe(true);
      expect(listed.structuredContent).toMatchObject({
        success: true,
        data: { partners: [{ name: "Safe Partner" }] },
      });
      expect(JSON.parse(toolText(listed))).toEqual(listed.structuredContent);
      expect(JSON.stringify(listed)).not.toContain("Partner Note text");

      partnerAdministration.getPartner.mockResolvedValueOnce({
        success: false,
        error: {
          code: "not_found",
          message: "Partner was not found.",
          next_step: "Check partner_id with list_partners, then retry.",
          retryable: false,
        },
      } as never);
      const missing = await client.callTool({
        name: "get_partner",
        arguments: { partner_id: "missing" },
      });
      expect(missing).toMatchObject({
        isError: true,
        structuredContent: {
          success: false,
          error: { code: "not_found", retryable: false, next_step: expect.any(String) },
        },
      });
      expect(JSON.parse(toolText(missing))).toEqual(missing.structuredContent);
    } finally {
      await client.close();
    }
  });

  it("returns structured validation errors before invoking the administration module", async () => {
    const client = await openClient(issueToken(["partners:read", "partners:draft:write"]));
    try {
      const invalidList = await client.callTool({
        name: "list_partners",
        arguments: { state: "deleted" },
      });
      const invalidGet = await client.callTool({
        name: "get_partner",
        arguments: { partner_id: "partner/1" },
      });
      const forbiddenCreate = await client.callTool({
        name: "create_partner_draft",
        arguments: {
          operation_id: "forbidden-create",
          name: "Forbidden Partner",
          type: "other",
          published: true,
          logo: "https://attacker.example/logo.svg",
          note_agent_visible: true,
        },
      });
      const forbiddenUpdate = await client.callTool({
        name: "update_partner_draft",
        arguments: {
          operation_id: "forbidden-update",
          partner_id: "partner-1",
          expected_updated_at: "2026-07-14 08:00:00.000Z",
          patch: { published: true, logo: "logo.svg", note_agent_visible: true },
        },
      });

      for (const result of [invalidList, invalidGet, forbiddenCreate, forbiddenUpdate]) {
        expect(result).toMatchObject({
          isError: true,
          structuredContent: {
            success: false,
            error: {
              code: "invalid_arguments",
              next_step: expect.any(String),
              retryable: false,
            },
          },
        });
        expect(JSON.parse(toolText(result))).toEqual(result.structuredContent);
      }
      expect(partnerAdministration.listPartners).not.toHaveBeenCalled();
      expect(partnerAdministration.getPartner).not.toHaveBeenCalled();
      expect(partnerAdministration.createPartnerDraft).not.toHaveBeenCalled();
      expect(partnerAdministration.updatePartnerDraft).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("rejects unsafe operation IDs as non-retryable structured input errors", async () => {
    const client = await openClient(issueToken(["partners:draft:write"]));
    try {
      for (const operationId of [
        " padded-operation-id",
        "wts_mcp_0123456789abcdef01234567_abcdefghijklmnopqrstuvwxyz",
      ]) {
        const result = await client.callTool({
          name: "create_partner_draft",
          arguments: {
            operation_id: operationId,
            name: "Unsafe Operation Partner",
            type: "other",
          },
        });
        expect(result).toMatchObject({
          isError: true,
          structuredContent: {
            success: false,
            error: { code: "invalid_arguments", retryable: false },
          },
        });
        expect(JSON.parse(toolText(result))).toEqual(result.structuredContent);
      }
      expect(partnerAdministration.createPartnerDraft).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("gives Partner scopes no programme, CFP, or opposite Partner authority", async () => {
    const readClient = await openClient(issueToken(["partners:read"]));
    try {
      await expect(
        readClient.callTool({
          name: "create_partner_draft",
          arguments: { operation_id: "denied", name: "Denied", type: "other" },
        }),
      ).rejects.toMatchObject({ code: 403 });
    } finally {
      await readClient.close();
    }

    const writeClient = await openClient(issueToken(["partners:draft:write"]));
    try {
      await expect(writeClient.callTool({ name: "list_partners", arguments: {} }))
        .rejects.toMatchObject({ code: 403 });
      await expect(writeClient.callTool({ name: "list_sessions", arguments: {} }))
        .rejects.toMatchObject({ code: 403 });
      await expect(writeClient.callTool({ name: "list_proposals", arguments: {} }))
        .rejects.toMatchObject({ code: 403 });
      expect(programmeData.fetchMcpSessions).not.toHaveBeenCalled();
      expect(programmeData.fetchMcpProposals).not.toHaveBeenCalled();
    } finally {
      await writeClient.close();
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

  it("preserves structured Partner validation errors inside a mixed JSON-RPC batch", async () => {
    const token = issueToken(["partners:read", "partners:draft:write"]);
    const request = new Request(MCP_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "create_partner_draft",
            arguments: { operation_id: "batch-invalid", name: "Invalid", type: "other", logo: "x" },
          },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "list_partners", arguments: {} },
        },
      ]),
    });

    const response = await POST({ request });
    const messages = await response.json() as Array<{
      id: number;
      result: { structuredContent?: Record<string, unknown>; isError?: boolean };
    }>;
    const byId = Object.fromEntries(messages.map((message) => [message.id, message.result]));

    expect(byId[1]).toMatchObject({
      isError: true,
      structuredContent: {
        success: false,
        error: { code: "invalid_arguments", retryable: false },
      },
    });
    expect(byId[2]).toMatchObject({
      structuredContent: { success: true, data: { partners: expect.any(Array) } },
    });
    expect(partnerAdministration.createPartnerDraft).not.toHaveBeenCalled();
    expect(partnerAdministration.listPartners).toHaveBeenCalledOnce();
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

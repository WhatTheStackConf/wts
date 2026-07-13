import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  authenticateMcpBearer,
  hasMcpScope,
  type AuthenticatedMcpToken,
  type McpScope,
} from "~/lib/mcp-auth";
import {
  type McpOriginDecision,
  validateMcpOrigin,
  withMcpCors,
} from "~/lib/mcp-http-security";
import {
  fetchMcpProgramSnapshot,
  fetchMcpProposalContext,
  fetchMcpProposals,
  fetchMcpSessions,
  fetchMcpSpeakers,
} from "~/lib/mcp-program-data";

const TOOL_SCOPES = {
  get_program_snapshot: ["programme:read", "cfp:read"],
  list_sessions: ["programme:read"],
  list_speakers: ["programme:read"],
  list_proposals: ["cfp:read"],
  get_proposal_context: ["cfp:read"],
} as const satisfies Record<string, readonly McpScope[]>;

type AdministrativeMcpTool = keyof typeof TOOL_SCOPES;

function jsonToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function hasRequiredScopes(auth: AuthenticatedMcpToken, tool: AdministrativeMcpTool) {
  return TOOL_SCOPES[tool].every((scope) => hasMcpScope(auth, scope));
}

function authErrorResponse(
  status: 401 | 403,
  error: string,
  origin: McpOriginDecision,
  requiredScopes: readonly McpScope[] = [],
) {
  const challenge =
    status === 403 && requiredScopes.length > 0
      ? `Bearer realm="wts-mcp", error="insufficient_scope", scope="${requiredScopes.join(" ")}"`
      : 'Bearer realm="wts-mcp"';
  return withMcpCors(
    new Response(JSON.stringify({ error }), {
      status,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": challenge,
      },
    }),
    origin,
  );
}

function assertToolCallScope(auth: AuthenticatedMcpToken, tool: AdministrativeMcpTool) {
  if (!hasRequiredScopes(auth, tool)) {
    throw new Error(`MCP token is missing scope for ${tool}`);
  }
}

function deniedToolCall(value: unknown, auth: AuthenticatedMcpToken): AdministrativeMcpTool | null {
  const messages = Array.isArray(value) ? value : [value];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const request = message as { method?: unknown; params?: { name?: unknown } };
    if (request.method !== "tools/call" || typeof request.params?.name !== "string") continue;
    if (!(request.params.name in TOOL_SCOPES)) continue;
    const tool = request.params.name as AdministrativeMcpTool;
    if (!hasRequiredScopes(auth, tool)) return tool;
  }
  return null;
}

function buildProgramMcpServer(auth: AuthenticatedMcpToken) {
  const server = new McpServer({
    name: "whatthestack-programme",
    version: "1.0.0",
  });

  if (hasRequiredScopes(auth, "get_program_snapshot")) {
    server.registerTool(
      "get_program_snapshot",
      {
        title: "Get Program Snapshot",
        description:
          "Return Sessions, Speakers, CFP Submissions, and aggregate counts for programme/stage design.",
        inputSchema: {},
      },
      async () => {
        assertToolCallScope(auth, "get_program_snapshot");
        return jsonToolResult(await fetchMcpProgramSnapshot());
      },
    );
  }

  if (hasRequiredScopes(auth, "list_sessions")) {
    server.registerTool(
      "list_sessions",
      {
        title: "List Sessions",
        description: "Return draft and published programme Sessions, optionally filtered by publication, canonical Track, or location.",
        inputSchema: {
          published: z.boolean().optional(),
          track: z.string().optional(),
          room: z.string().optional(),
        },
      },
      async (args) => {
        assertToolCallScope(auth, "list_sessions");
        let sessions = await fetchMcpSessions();
        if (typeof args.published === "boolean") {
          sessions = sessions.filter((session) => session.published === args.published);
        }
        if (args.track) {
          const track = args.track.toLowerCase();
          sessions = sessions.filter((session) => (session.schedule?.track?.name || "").toLowerCase() === track);
        }
        if (args.room) {
          const room = args.room.toLowerCase();
          sessions = sessions.filter((session) => (session.schedule?.location_label || "").toLowerCase() === room);
        }
        return jsonToolResult(sessions);
      },
    );
  }

  if (hasRequiredScopes(auth, "list_speakers")) {
    server.registerTool(
      "list_speakers",
      {
        title: "List Speakers",
        description: "Return draft and published public Speaker profiles, optionally filtered by publication or origin.",
        inputSchema: {
          published: z.boolean().optional(),
          origin: z.enum(["cfp", "invite"]).optional(),
        },
      },
      async (args) => {
        assertToolCallScope(auth, "list_speakers");
        let speakers = await fetchMcpSpeakers();
        if (typeof args.published === "boolean") {
          speakers = speakers.filter((speaker) => speaker.published === args.published);
        }
        if (args.origin) speakers = speakers.filter((speaker) => speaker.origin === args.origin);
        return jsonToolResult(speakers);
      },
    );
  }

  if (hasRequiredScopes(auth, "list_proposals")) {
    server.registerTool(
      "list_proposals",
      {
        title: "List Proposals",
        description:
          "Return CFP Submissions with applicant context and review score summaries for programme acceptance decisions.",
        inputSchema: {
          status: z.enum(["pending", "accepted", "rejected"]).optional(),
        },
      },
      async (args) => {
        assertToolCallScope(auth, "list_proposals");
        return jsonToolResult(await fetchMcpProposals(args.status));
      },
    );
  }

  if (hasRequiredScopes(auth, "get_proposal_context")) {
    server.registerTool(
      "get_proposal_context",
      {
        title: "Get Proposal Context",
        description:
          "Return one CFP Submission with applicant context and review summary for acceptance decisions.",
        inputSchema: {
          submission_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
        },
      },
      async (args) => {
        assertToolCallScope(auth, "get_proposal_context");
        return jsonToolResult(await fetchMcpProposalContext(args.submission_id));
      },
    );
  }

  server.server.onerror = (error) => {
    console.error(`MCP error for token ${auth.id}:`, error);
  };

  return server;
}

async function handleMcpRequest(request: Request) {
  const origin = validateMcpOrigin(request);
  if (!origin.allowed) {
    return withMcpCors(
      new Response(JSON.stringify({ error: "Origin is not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
      origin,
    );
  }

  if (request.method === "OPTIONS") {
    return withMcpCors(new Response(null, { status: 204 }), origin);
  }

  const auth = await authenticateMcpBearer(request.headers.get("authorization"));
  if (!auth.success) return authErrorResponse(auth.status, auth.error, origin);

  if (auth.token.scopes.length === 0) {
    return authErrorResponse(403, "MCP token has no authorized scopes", origin, [
      "programme:read",
      "cfp:read",
    ]);
  }

  if (request.method !== "POST") {
    return withMcpCors(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        }),
        {
          status: 405,
          headers: { "Content-Type": "application/json", Allow: "POST, OPTIONS" },
        },
      ),
      origin,
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.clone().json();
  } catch {
    parsedBody = undefined;
  }
  const deniedTool = deniedToolCall(parsedBody, auth.token);
  if (deniedTool) {
    const requiredScopes = TOOL_SCOPES[deniedTool];
    return authErrorResponse(
      403,
      `MCP token is missing required scope for ${deniedTool}`,
      origin,
      requiredScopes,
    );
  }

  const server = buildProgramMcpServer(auth.token);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  try {
    const response = await transport.handleRequest(request, {
      parsedBody,
      authInfo: {
        token: auth.token.id,
        clientId: auth.token.createdBy,
        scopes: auth.token.scopes,
        expiresAt: auth.token.expiresAt
          ? Math.floor(Date.parse(auth.token.expiresAt) / 1000)
          : undefined,
      },
    });
    return withMcpCors(response, origin);
  } finally {
    await server.close();
  }
}

export async function GET({ request }: { request: Request }) {
  return handleMcpRequest(request);
}

export async function POST({ request }: { request: Request }) {
  return handleMcpRequest(request);
}

export async function DELETE({ request }: { request: Request }) {
  return handleMcpRequest(request);
}

export async function OPTIONS({ request }: { request: Request }) {
  return handleMcpRequest(request);
}

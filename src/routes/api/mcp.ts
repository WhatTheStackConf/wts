import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  authenticateMcpBearer,
  hasMcpScope,
  type AuthenticatedMcpToken,
} from "~/lib/mcp-auth";
import {
  fetchMcpProgramSnapshot,
  fetchMcpProposalContext,
  fetchMcpProposals,
  fetchMcpSessions,
  fetchMcpSpeakers,
} from "~/lib/mcp-program-data";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version, MCP-Session-Id",
};

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

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function authErrorResponse(status: 401 | 403, error: string) {
  return withCors(
    new Response(JSON.stringify({ error }), {
      status,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="wts-mcp"',
      },
    }),
  );
}

function buildProgramMcpServer(auth: AuthenticatedMcpToken) {
  const server = new McpServer({
    name: "whatthestack-programme",
    version: "1.0.0",
  });

  server.registerTool(
    "get_program_snapshot",
    {
      title: "Get Program Snapshot",
      description:
        "Return Sessions, Speakers, CFP Submissions, and aggregate counts for programme/stage design.",
      inputSchema: {},
    },
    async () => jsonToolResult(await fetchMcpProgramSnapshot()),
  );

  server.registerTool(
    "list_sessions",
    {
      title: "List Sessions",
      description: "Return draft and published programme Sessions, optionally filtered by publication, track, or room.",
      inputSchema: {
        published: z.boolean().optional(),
        track: z.string().optional(),
        room: z.string().optional(),
      },
    },
    async (args) => {
      let sessions = await fetchMcpSessions();
      if (typeof args.published === "boolean") {
        sessions = sessions.filter((session) => session.published === args.published);
      }
      if (args.track) {
        const track = args.track.toLowerCase();
        sessions = sessions.filter((session) => (session.track || "").toLowerCase() === track);
      }
      if (args.room) {
        const room = args.room.toLowerCase();
        sessions = sessions.filter((session) => (session.room || "").toLowerCase() === room);
      }
      return jsonToolResult(sessions);
    },
  );

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
      let speakers = await fetchMcpSpeakers();
      if (typeof args.published === "boolean") {
        speakers = speakers.filter((speaker) => speaker.published === args.published);
      }
      if (args.origin) speakers = speakers.filter((speaker) => speaker.origin === args.origin);
      return jsonToolResult(speakers);
    },
  );

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
    async (args) => jsonToolResult(await fetchMcpProposals(args.status)),
  );

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
    async (args) => jsonToolResult(await fetchMcpProposalContext(args.submission_id)),
  );

  server.server.onerror = (error) => {
    console.error(`MCP error for token ${auth.id}:`, error);
  };

  return server;
}

async function handleMcpRequest(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const auth = await authenticateMcpBearer(request.headers.get("authorization"));
  if (!auth.success) return authErrorResponse(auth.status, auth.error);

  if (!hasMcpScope(auth.token, "program:read")) {
    return authErrorResponse(403, "MCP token is missing program:read scope");
  }

  const server = buildProgramMcpServer(auth.token);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  const response = await transport.handleRequest(request, {
    authInfo: {
      token: auth.token.id,
      clientId: auth.token.createdBy,
      scopes: auth.token.scopes,
      expiresAt: auth.token.expiresAt
        ? Math.floor(Date.parse(auth.token.expiresAt) / 1000)
        : undefined,
    },
  });

  return withCors(response);
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

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ConferenceGuideService } from "~/lib/conference-guide";
import {
  type McpOriginDecision,
  validateMcpOrigin,
  withMcpCors,
} from "~/lib/mcp-http-security";
import { publicMcpProtection } from "~/lib/mcp-public-protection";
import { buildPublicMcpServer } from "~/lib/mcp-public-server";

export interface PublicMcpRequestEvent {
  request: Request;
  clientAddress?: string;
}

const MAX_REQUEST_BYTES = 64 * 1_024;
const MAX_BATCH_MESSAGES = 8;

class PublicMcpRequestTooLargeError extends Error {}

function withPublicMcpCors(response: Response, origin: McpOriginDecision): Response {
  const wrapped = withMcpCors(response, origin);
  const headers = new Headers(wrapped.headers);
  const exposed = headers.get("Access-Control-Expose-Headers") || "";
  headers.set(
    "Access-Control-Expose-Headers",
    [...exposed.split(",").map((value) => value.trim()).filter(Boolean), "Retry-After"].join(", "),
  );
  return new Response(wrapped.body, {
    status: wrapped.status,
    statusText: wrapped.statusText,
    headers,
  });
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: McpOriginDecision,
  headers: HeadersInit = {},
) {
  return withPublicMcpCors(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  }), origin);
}

function requestWeight(parsedBody: unknown): number {
  let weight = 0;
  for (const message of Array.isArray(parsedBody) ? parsedBody : [parsedBody]) {
    if (!message || typeof message !== "object") {
      weight += 1;
      continue;
    }
    const method = (message as { method?: unknown }).method;
    weight += method === "resources/read" ? 3 : 1;
  }
  return Math.max(weight, 1);
}

function clientAddress(event: PublicMcpRequestEvent): string | undefined {
  if (process.env.MCP_TRUST_PROXY === "true") {
    const forwarded = event.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return event.clientAddress?.trim() || undefined;
}

async function parseBoundedBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new PublicMcpRequestTooLargeError();
  }
  const reader = request.clone().body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      void reader.cancel();
      throw new PublicMcpRequestTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function handlePublicMcpRequest(
  event: PublicMcpRequestEvent,
  guide: ConferenceGuideService,
) {
  const request = event.request;
  const origin = validateMcpOrigin(request);
  if (!origin.allowed) {
    return jsonResponse({ error: "Origin is not allowed" }, 403, origin);
  }
  if (request.headers.has("authorization")) {
    return jsonResponse(
      { error: "Authorization is not accepted by the anonymous public MCP endpoint." },
      400,
      origin,
    );
  }
  if (request.method === "OPTIONS") {
    return withPublicMcpCors(new Response(null, { status: 204 }), origin);
  }
  if (request.method !== "POST") {
    return jsonResponse(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      },
      405,
      origin,
      { Allow: "POST, OPTIONS" },
    );
  }

  const address = clientAddress(event);
  const initialPermit = publicMcpProtection.acquire({ clientAddress: address, weight: 1 });
  if (!initialPermit.allowed) {
    return jsonResponse(
      { error: "Public MCP capacity is temporarily exhausted. Retry later." },
      429,
      origin,
      { "Retry-After": String(initialPermit.retryAfter) },
    );
  }

  let weightedPermit: ReturnType<typeof publicMcpProtection.acquire> | undefined;
  try {
    let parsedBody: unknown;
    try {
      parsedBody = await parseBoundedBody(request);
    } catch (error) {
      if (error instanceof PublicMcpRequestTooLargeError) {
        return jsonResponse({ error: "Public MCP request body is too large." }, 413, origin);
      }
      throw error;
    }
    if (Array.isArray(parsedBody) && parsedBody.length > MAX_BATCH_MESSAGES) {
      return jsonResponse({ error: "Public MCP JSON-RPC batch is too large." }, 400, origin);
    }

    const remainingWeight = requestWeight(parsedBody) - 1;
    if (remainingWeight > 0) {
      weightedPermit = publicMcpProtection.acquire({
        clientAddress: address,
        weight: remainingWeight,
      });
      if (!weightedPermit.allowed) {
        return jsonResponse(
          { error: "Public MCP capacity is temporarily exhausted. Retry later." },
          429,
          origin,
          { "Retry-After": String(weightedPermit.retryAfter) },
        );
      }
    }

    const server = buildPublicMcpServer(guide);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return withPublicMcpCors(
        await transport.handleRequest(request, { parsedBody }),
        origin,
      );
    } finally {
      await server.close();
    }
  } finally {
    if (weightedPermit?.allowed) weightedPermit.release();
    initialPermit.release();
  }
}

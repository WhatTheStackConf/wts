import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ConferenceGuideService } from "~/lib/conference-guide";
import {
  type McpOriginDecision,
  validateMcpOrigin,
  withMcpCors,
} from "~/lib/mcp-http-security";
import { publicMcpProtection } from "~/lib/mcp-public-protection";
import {
  buildPublicMcpServer,
  hasValidPublicSearchInput,
  invalidPublicSearchArgumentsToolResult,
  PUBLIC_SESSION_SEARCH_TOOL,
} from "~/lib/mcp-public-server";

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
    const request = message as { method?: unknown; params?: { name?: unknown } };
    if (request.method === "resources/read") {
      weight += 3;
    } else if (
      request.method === "tools/call" &&
      request.params?.name === PUBLIC_SESSION_SEARCH_TOOL
    ) {
      weight += 4;
    } else {
      weight += 1;
    }
  }
  return Math.max(weight, 1);
}

function requestIdKey(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || value === null) {
    return JSON.stringify(value);
  }
  return undefined;
}

function invalidSearchCallIds(value: unknown): Set<string> {
  const calls = new Set<string>();
  for (const message of Array.isArray(value) ? value : [value]) {
    if (!message || typeof message !== "object") continue;
    const request = message as {
      id?: unknown;
      method?: unknown;
      params?: { name?: unknown; arguments?: unknown };
    };
    const id = requestIdKey(request.id);
    if (
      id !== undefined &&
      request.method === "tools/call" &&
      request.params?.name === PUBLIC_SESSION_SEARCH_TOOL &&
      !hasValidPublicSearchInput(request.params.arguments)
    ) calls.add(id);
  }
  return calls;
}

async function withStructuredPublicValidationErrors(
  parsedBody: unknown,
  response: Response,
): Promise<Response> {
  const invalidCalls = invalidSearchCallIds(parsedBody);
  if (
    invalidCalls.size === 0 ||
    !response.headers.get("Content-Type")?.includes("application/json")
  ) return response;

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  let changed = false;
  const messages = Array.isArray(body) ? body : [body];
  const updated = messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const rpc = message as { id?: unknown; result?: { isError?: unknown } };
    const id = requestIdKey(rpc.id);
    if (!id || !invalidCalls.has(id) || rpc.result?.isError !== true) return message;
    changed = true;
    return { ...rpc, result: invalidPublicSearchArgumentsToolResult() };
  });
  if (!changed) return response;

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(JSON.stringify(Array.isArray(body) ? updated : updated[0]), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
      const response = await transport.handleRequest(request, { parsedBody });
      return withPublicMcpCors(
        await withStructuredPublicValidationErrors(parsedBody, response),
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

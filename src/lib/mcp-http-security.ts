const WTS_ORIGIN = "https://wts.sh";
const SITE_ORIGIN_ENV_KEYS = ["PUBLIC_SITE_URL", "SITE_URL", "VITE_SITE_URL"] as const;

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version, MCP-Session-Id",
};

export type McpOriginDecision =
  | { allowed: true; origin: string | null }
  | { allowed: false; origin: null };

function configuredOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function suppliedOrigin(value: string): string | null {
  const normalized = configuredOrigin(value);
  return normalized === value ? normalized : null;
}

function allowedOrigins(): Set<string> {
  const origins = new Set([WTS_ORIGIN]);
  for (const key of SITE_ORIGIN_ENV_KEYS) {
    const value = process.env[key];
    const origin = value ? configuredOrigin(value) : null;
    if (origin) origins.add(origin);
  }
  for (const value of (process.env.MCP_ALLOWED_ORIGINS || "").split(",")) {
    const origin = configuredOrigin(value);
    if (origin) origins.add(origin);
  }
  return origins;
}

export function validateMcpOrigin(request: Request): McpOriginDecision {
  const header = request.headers.get("origin");
  if (header === null) return { allowed: true, origin: null };

  const origin = suppliedOrigin(header);
  if (!origin || !allowedOrigins().has(origin)) return { allowed: false, origin: null };
  return { allowed: true, origin };
}

function appendVary(headers: Headers, value: string) {
  const current = headers.get("Vary");
  const values = current
    ? current.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) {
    values.push(value);
  }
  headers.set("Vary", values.join(", "));
}

export function withMcpCors(response: Response, decision: McpOriginDecision): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  if (decision.allowed && decision.origin) {
    headers.set("Access-Control-Allow-Origin", decision.origin);
  } else {
    headers.delete("Access-Control-Allow-Origin");
  }
  appendVary(headers, "Origin");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

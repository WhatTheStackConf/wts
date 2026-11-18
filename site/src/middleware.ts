import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import type { StartMiddleware, StartRequestEvent } from "@solidjs/vite-plugin";
import { Router } from "~/router";
import { rejectPublicMcpCredentials } from "~/lib/mcp-public-http";

async function stripAnonymousCredentials(
  event: StartRequestEvent,
  next: () => Promise<Response>,
) {
  const { request } = event;
  const pathname = new URL(request.url).pathname;
  const publicMcp = /^\/api\/mcp\/public\/?$/.test(pathname);
  if (publicMcp) {
    const rejected = rejectPublicMcpCredentials(request);
    if (rejected) return rejected;
  }
  if (publicMcp || /^\/api\/public\/v1(?:\/|$)/.test(pathname)) {
    request.headers.delete("cookie");
    request.headers.delete("authorization");
  }
  return next();
}

function requestsMissingPage(request: Request, pathname: string): boolean {
  const matches = Router.match(pathname);
  return request.method === "GET" &&
    request.headers.get("accept")?.includes("text/html") === true &&
    matches.some((match) => match.pattern.includes("*404"));
}

async function preserveDeclaredStatus(
  event: StartRequestEvent,
  next: () => Promise<Response>,
) {
  const { request } = event;
  const pathname = new URL(request.url).pathname;
  if (/^\/(?:api|media|auth)(?:\/|$)/.test(pathname) ||
      ["/readyz", "/login", "/register", "/forgot-password"].includes(pathname.replace(/\/$/, ""))) return next();
  if (requestsMissingPage(request, pathname)) event.response.status = 404;
  const response = await next();
  const declaredStatus = event.response.status;
  if (!declaredStatus || declaredStatus === response.status) return response;
  return new Response(response.body, {
    status: declaredStatus,
    headers: response.headers,
  });
}

async function protectAccountResponse(
  event: StartRequestEvent,
  next: () => Promise<Response>,
) {
  const response = await next();
  const pathname = new URL(event.request.url).pathname;
  if (/^\/(?:user|auth)(?:\/|$)/.test(pathname) ||
    ["/login", "/register", "/forgot-password"].includes(pathname.replace(/\/$/, ""))) {
    response.headers.set("Cache-Control", "private, no-store");
    // Native same-origin logout forms need a non-null Origin header.
    response.headers.set("Referrer-Policy", pathname === "/user" || pathname.startsWith("/user/") ? "same-origin" : "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

const middleware: StartMiddleware[] = [stripAnonymousCredentials, protectAccountResponse, preserveDeclaredStatus, createAPIHandler(routes)];
export default middleware;

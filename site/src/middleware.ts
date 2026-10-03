import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import { getRequestEvent } from "@solidjs/web";
import { Router } from "~/router";
import { rejectPublicMcpCredentials } from "~/lib/mcp-public-http";

async function stripAnonymousCredentials(
  request: Request,
  next: (request?: Request) => Promise<Response>,
) {
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

async function preserveDeclaredStatus(
  request: Request,
  next: (request?: Request) => Promise<Response>,
) {
  const pathname = new URL(request.url).pathname;
  if (/^\/(?:api|media|auth)(?:\/|$)/.test(pathname) ||
      ["/readyz", "/login", "/register", "/forgot-password"].includes(pathname.replace(/\/$/, ""))) return next();
  const matches = Router.match(pathname);
  const isNotFoundPage =
    request.method === "GET" &&
    request.headers.get("accept")?.includes("text/html") === true &&
    matches.some((match) => match.pattern.includes("*404"));
  const event = getRequestEvent();
  if (isNotFoundPage && event) event.response.status = 404;
  const response = await next();
  const declaredStatus = event?.response.status;
  if (!declaredStatus || declaredStatus === response.status) return response;
  return new Response(response.body, {
    status: declaredStatus,
    headers: response.headers,
  });
}

async function protectAccountResponse(
  request: Request,
  next: (request?: Request) => Promise<Response>,
) {
  const response = await next();
  const pathname = new URL(request.url).pathname;
  if (/^\/(?:user|auth)(?:\/|$)/.test(pathname) ||
    ["/login", "/register", "/forgot-password"].includes(pathname.replace(/\/$/, ""))) {
    response.headers.set("Cache-Control", "private, no-store");
    // Native same-origin logout forms need a non-null Origin header.
    response.headers.set("Referrer-Policy", pathname === "/user" || pathname.startsWith("/user/") ? "same-origin" : "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export default [stripAnonymousCredentials, protectAccountResponse, preserveDeclaredStatus, createAPIHandler(routes)];

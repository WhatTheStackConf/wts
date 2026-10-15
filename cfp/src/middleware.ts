import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import { getRequestEvent } from "@solidjs/web";
import { Router } from "~/router";

const AUTH_PATH = /^\/auth(?:\/|$)/;
const PRIVATE_PAGE_PATH = /^\/(?:applications|apply|profile|settings|reviewer|admin)(?:\/|$)/;

function requestsMissingPage(request: Request, pathname: string) {
  return request.method === "GET" && request.headers.get("accept")?.includes("text/html") &&
    Router.match(pathname).some((match) => match.pattern.includes("*404"));
}

async function preserveDeclaredStatus(request: Request, next: (request?: Request) => Promise<Response>) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/readyz" || AUTH_PATH.test(pathname)) return next();
  const event = getRequestEvent();
  if (requestsMissingPage(request, pathname) && event) event.response.status = 404;
  const response = await next();
  const status = event?.response.status;
  if (!status || status === response.status || response.status !== 200) return response;
  return new Response(response.body, { status, headers: response.headers });
}

function setPrivateHeaders(headers: Headers, auth: boolean) {
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Referrer-Policy", auth ? "no-referrer" : "same-origin");
}

async function protectPrivateResponse(request: Request, next: (request?: Request) => Promise<Response>) {
  const pathname = new URL(request.url).pathname;
  const auth = AUTH_PATH.test(pathname);
  const isPrivate = auth || pathname === "/" || PRIVATE_PAGE_PATH.test(pathname) || pathname.startsWith("/_server");
  const headers = getRequestEvent()?.response.headers;
  if (isPrivate && headers) setPrivateHeaders(headers, auth);
  const response = await next();
  if (isPrivate) setPrivateHeaders(response.headers, auth);
  return response;
}

export default [protectPrivateResponse, preserveDeclaredStatus, createAPIHandler(routes)];

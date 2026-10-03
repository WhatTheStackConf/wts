import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import { getRequestEvent } from "@solidjs/web";
import { Router } from "~/router";

async function preserveDeclaredStatus(request: Request, next: (request?: Request) => Promise<Response>) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/readyz" || /^\/auth(?:\/|$)/.test(pathname)) return next();
  const event = getRequestEvent();
  if (request.method === "GET" && request.headers.get("accept")?.includes("text/html") &&
      Router.match(pathname).some((match) => match.pattern.includes("*404")) && event) {
    event.response.status = 404;
  }
  const response = await next();
  const status = event?.response.status;
  if (!status || status === response.status || response.status !== 200) return response;
  return new Response(response.body, { status, headers: response.headers });
}

async function protectApplicantResponse(request: Request, next: (request?: Request) => Promise<Response>) {
  const pathname = new URL(request.url).pathname;
  const auth = /^\/auth(?:\/|$)/.test(pathname);
  const applicant = pathname === "/" || /^\/(?:applications|apply|profile|settings)(?:\/|$)/.test(pathname);
  const rpc = pathname.startsWith("/_server");
  const headers = getRequestEvent()?.response.headers;
  if (auth || applicant || rpc) {
    headers?.set("Cache-Control", "private, no-store");
    headers?.set("X-Robots-Tag", "noindex, nofollow");
    headers?.set("Referrer-Policy", auth ? "no-referrer" : "same-origin");
  }
  const response = await next();
  if (auth || applicant || rpc) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Referrer-Policy", auth ? "no-referrer" : "same-origin");
  }
  return response;
}

export default [protectApplicantResponse, preserveDeclaredStatus, createAPIHandler(routes)];

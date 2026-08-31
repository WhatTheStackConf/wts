import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import { getRequestEvent } from "@solidjs/web";
import { Router } from "~/router";
import {
  hasValidSpeakerGuidePassword,
  requiresSpeakerGuidePassword,
} from "~/lib/speaker-guide-access";

const privatePageHeaders = new Headers({
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
});

async function protectSpeakerGuide(
  request: Request,
  next: (request?: Request) => Promise<Response>,
) {
    const url = new URL(request.url);
    if (!requiresSpeakerGuidePassword(url.pathname)) return next();

    if (!hasValidSpeakerGuidePassword(url)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: privatePageHeaders,
      });
    }

    const response = await next();
    privatePageHeaders.forEach((value, name) => response.headers.set(name, value));
    return response;
}

async function preserveDeclaredStatus(
  request: Request,
  next: (request?: Request) => Promise<Response>,
) {
  const matches = Router.match(new URL(request.url).pathname);
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

export default [preserveDeclaredStatus, protectSpeakerGuide, createAPIHandler(routes)];

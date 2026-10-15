import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import { getRequestEvent } from "@solidjs/web";
import { Router } from "~/router";
import { isCheckinPath, protectCheckinResponse } from "~/lib/checkin-privacy";
import { isFeedbackPath, protectFeedbackResponse } from "~/lib/feedback-privacy";
import {
  hasValidSpeakerGuidePassword,
  requiresSpeakerGuidePassword,
} from "~/lib/speaker-guide-access";
import { capabilityForPath } from "~/lib/conference-capability-policy";
import { capabilityAvailable } from "~/lib/capability-availability";

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

async function protectDormantCfpAndReview(request: Request, next: (request?: Request) => Promise<Response>) {
  const capability = capabilityForPath(new URL(request.url).pathname);
  if (!capability || await capabilityAvailable(capability)) return next();
  return new Response("Not Found", { status: 404, headers: privatePageHeaders });
}

async function preserveDeclaredStatus(
  request: Request,
  next: (request?: Request) => Promise<Response>,
) {
  const pathname = new URL(request.url).pathname;
  // Public API routes own their status, including when opened in a browser.
  // The page router's catch-all must not turn valid JSON discovery into a 404.
  if (/^\/api\/public\/v1(?:\/|$)/.test(pathname)) return next();
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

async function protectCheckin(request: Request, next: (request?: Request) => Promise<Response>) {
  const response = await next();
  return isCheckinPath(new URL(request.url).pathname) ? protectCheckinResponse(response) : response;
}

async function protectLiveQa(request: Request, next: (request?: Request) => Promise<Response>) {
  const response = await next();
  const path = new URL(request.url).pathname;
  if (path === "/mc" || path === "/mc/" || path === "/api/live-qa" || path === "/api/live-qa/") {
    privatePageHeaders.forEach((value, name) => response.headers.set(name, value));
  }
  return response;
}

async function protectFeedback(request: Request, next: (request?: Request) => Promise<Response>) {
  if (!isFeedbackPath(new URL(request.url).pathname)) return next();
  // Nitro supplies a lazy request facade, not an Undici-branded Request.
  // Mutate its headers rather than passing that facade into new Request().
  request.headers.delete("cookie");
  request.headers.delete("authorization");
  return protectFeedbackResponse(await next());
}

export default [protectFeedback, preserveDeclaredStatus, protectDormantCfpAndReview, protectSpeakerGuide, protectCheckin, protectLiveQa, createAPIHandler(routes)];

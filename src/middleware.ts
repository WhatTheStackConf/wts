import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import { getRequestEvent } from "@solidjs/web";
import { Router } from "~/router";
import { isFeedbackAdminPath } from "~/lib/feedback-admin-privacy";
import { isFeedbackPath, protectFeedbackResponse } from "~/lib/feedback-privacy";
import { crewRaffleResponse, isCrewRafflePath } from "~/lib/crew-raffle";
import { loadCrewRaffleRows } from "~/lib/crew-raffle-store";
import { isCheckinPath, protectCheckinResponse } from "~/lib/checkin-privacy";
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

async function crewRaffle(request: Request, next: (request?: Request) => Promise<Response>) {
  if (!isCrewRafflePath(new URL(request.url).pathname)) return next();
  return crewRaffleResponse(request, loadCrewRaffleRows, {
    tokenSha256: process.env.RAFFLE_SHARE_TOKEN_SHA256,
    expiresAt: process.env.RAFFLE_SHARE_EXPIRES_AT,
  });
}

async function protectFeedback(request: Request, next: (request?: Request) => Promise<Response>) {
  if (!isFeedbackPath(new URL(request.url).pathname)) return next();
  // Nitro supplies a lazy request facade, not an Undici-branded Request.
  request.headers.delete("cookie");
  request.headers.delete("authorization");
  return protectFeedbackResponse(await next());
}

async function protectFeedbackAdmin(request: Request, next: (request?: Request) => Promise<Response>) {
  const response = await next();
  return isFeedbackAdminPath(new URL(request.url).pathname) ? protectCheckinResponse(response) : response;
}

export default [protectFeedbackAdmin, protectFeedback, crewRaffle, preserveDeclaredStatus, protectSpeakerGuide, protectCheckin, protectLiveQa, createAPIHandler(routes)];

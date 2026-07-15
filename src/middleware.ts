import { createMiddleware } from "@solidjs/start/middleware";
import {
  hasValidSpeakerGuidePassword,
  requiresSpeakerGuidePassword,
} from "~/lib/speaker-guide-access";

const privatePageHeaders = new Headers({
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
});

export default createMiddleware([
  (event) => {
    const url = new URL(event.req.url);
    if (!requiresSpeakerGuidePassword(url.pathname)) return;

    privatePageHeaders.forEach((value, name) => {
      event.res.headers.set(name, value);
    });

    if (!hasValidSpeakerGuidePassword(url)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: privatePageHeaders,
      });
    }
  },
]);

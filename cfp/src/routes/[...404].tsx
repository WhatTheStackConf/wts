import { httpStatus, isServer } from "@solidjs/web";
import type { RouteDefinition } from "@solidjs/router";

export const route = { preload: () => httpStatus(404) } satisfies RouteDefinition;

export default function NotFound() {
  if (isServer) httpStatus(404);
  return <section class="surface cfp-stack" aria-labelledby="not-found-title">
    <p class="mono">404 · NOT FOUND</p>
    <h1 id="not-found-title">This page is not here.</h1>
    <p class="muted">The address may be outdated, or this page may have moved.</p>
    <div class="row"><a class="button" href="/">Go to CFP home</a><a class="button button-secondary" href="/applications">Applicant dashboard</a></div>
  </section>;
}

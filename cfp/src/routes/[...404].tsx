import { httpStatus, isServer } from "@solidjs/web";
import type { RouteDefinition } from "@solidjs/router";
import { PageBand } from "~/components/PageBand";

export const route = { preload: () => httpStatus(404) } satisfies RouteDefinition;

export default function NotFound() {
  if (isServer) httpStatus(404);
  return <>
    <PageBand title="This page is not here." lede="The address may be outdated, or this page may have moved." />
    <section class="not-found" aria-label="Page not found">
      <p class="mono">404 · NOT FOUND</p>
      <div class="row"><a class="button" href="/">Go to CFP home</a><a class="button button-secondary" href="/applications">Applicant dashboard</a></div>
    </section>
  </>;
}

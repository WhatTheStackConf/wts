import { httpStatus, isServer } from "@solidjs/web";
import type { RouteDefinition } from "@solidjs/router";
import { PublicPageShell, SupportBand } from "~/components/PublicPageShell";

export const route = {
  preload: () => httpStatus(404),
} satisfies RouteDefinition;

export default function NotFound() {
  if (isServer) httpStatus(404);
  return (
    <PublicPageShell title="Page not found" description="This page is not available. Find your way back to WhatTheStack or explore past editions.">
      <section class="support-not-found" aria-labelledby="not-found-heading">
        <SupportBand altitude={2} label="404 · Not found" variant="lost">
          <h1 id="not-found-heading" class="support-band-title">This page isn’t here.</h1>
          <p class="support-band-lede">The address may be outdated, or the page may have moved.</p>
          <nav class="support-actions" aria-label="Not found navigation">
            <a href="/">Home</a>
            <a href="/#archive">Past editions</a>
          </nav>
        </SupportBand>
      </section>
    </PublicPageShell>
  );
}

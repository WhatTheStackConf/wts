import { httpStatus, isServer } from "@solidjs/web";
import type { RouteDefinition } from "@solidjs/router";
import { PublicPageShell } from "~/components/PublicPageShell";

export const route = {
  preload: () => httpStatus(404),
} satisfies RouteDefinition;

export default function NotFound() {
  if (isServer) httpStatus(404);
  return (
    <PublicPageShell title="Page not found" description="This page is not available. Find your way back to WhatTheStack or explore past editions.">
      <section class="support-not-found" aria-labelledby="not-found-heading">
        <p class="support-kicker">404 · Not found</p>
        <h1 id="not-found-heading">This page isn’t here.</h1>
        <p>The address may be outdated, or the page may have moved.</p>
        <nav aria-label="Not found navigation">
          <a href="/">Home</a>
          <a href="/#archive">Past editions</a>
        </nav>
      </section>
    </PublicPageShell>
  );
}

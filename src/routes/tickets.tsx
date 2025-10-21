import { Title } from "@solidjs/meta";
import { Layout } from "../layouts/Layout";
import { fetchTitoReleases, TitoRelease } from "../lib/tito";
import { createResource, Show, For } from "solid-js";

// Define the fetch function for releases API
const fetchReleases = async (): Promise<TitoRelease[]> => {
  "use server";
  const response = await fetchTitoReleases();
  return response;
};

export default function Tickets() {
  const [releases] = createResource<TitoRelease[]>(fetchReleases);

  return (
    <Layout
      title="Tickets - WhatTheStack 2026"
      description="Get your tickets for WhatTheStack 2026 conference"
    >
      <div class="container mx-auto relative">
        <div class="absolute inset-0 scanline z-10"></div>
        <div class="max-w-4xl mx-auto text-center relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-4 neon-glow fade-in">
            Conference Tickets
          </h1>
          <p class="text-xl text-secondary-300 mb-12 fade-in-delay-1">
            Secure your place at the future of web development
          </p>

          <Show
            when={!releases.loading}
            fallback={
              <div class="flex justify-center items-center h-64">
                <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
              </div>
            }
          >
            <Show
              when={!releases.error}
              fallback={
                <div class="text-center py-12">
                  <div class="text-error text-xl mb-4">
                    Error loading tickets
                  </div>
                  <p class="text-secondary-300">
                    Please try again later or contact support
                  </p>
                </div>
              }
            >
              <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12 fade-in-delay-2">
                <For each={releases()}>
                  {(release, index) => (
                    <div
                      class={`bg-base-200/70 backdrop-blur-sm border border-primary-500/30 rounded-lg p-6 transform transition duration-300 hover:scale-105 hover-pulse grid-scan ${index() === 1 ? "border-2 border-primary-500 relative" : ""}`}
                    >
                      <Show when={index() === 1}>
                        <div class="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-primary-500 text-base-100 px-4 py-1 rounded font-star neon-glow">
                          POPULAR
                        </div>
                      </Show>
                      <h2 class="text-2xl font-star text-primary-500 mb-4">
                        {release.title}
                      </h2>
                      <div class="text-3xl font-star text-secondary-300 mb-4">
                        {release.price !== null ? `€${release.price}` : "FREE"}
                      </div>
                      <p class="text-secondary-300 mb-4 text-left">
                        {release.description || "Available for the conference"}
                      </p>
                      <ul class="text-secondary-300 space-y-2 mb-6">
                        <li>✓ Conference talks</li>
                        <li>✓ Pre-events</li>
                        <li>✓ After party</li>
                        <li>✓ Swag</li>
                        <li>✓ Lunch</li>
                        <li>✓ Coffee</li>
                      </ul>
                      <a
                        href={release.share_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="btn btn-primary w-full font-star tracking-wider text-base-100 neon-glow hover-pulse"
                      >
                        GET TICKET
                      </a>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </Layout>
  );
}

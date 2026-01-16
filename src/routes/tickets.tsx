import { Title } from "@solidjs/meta";
import { Layout } from "../layouts/Layout";
import { fetchHiEventsReleases, HiEventsRelease } from "../lib/hievents";
import { createResource, Show, For } from "solid-js";

// Define the fetch function for releases API
const fetchReleases = async (): Promise<HiEventsRelease[]> => {
  "use server";
  const apiReleases = await fetchHiEventsReleases();

  // Hardcoded Student Ticket
  const studentTicket: HiEventsRelease = {
    id: 999, // Dummy ID
    title: "Student Ticket",
    description:
      "Discounted entry for students. Requires valid student ID card verification.",
    price: 20,
    currency: "EUR",
    is_available: true,
    sales_start_date: null,
    sales_end_date: null,
    quantity_sold: 0,
    quantity_available: null,
    purchase_link:
      "mailto:students@wts.sh?subject=Student%20Ticket%20Verification&body=Hello%2C%0A%0AI%20would%20like%20to%20apply%20for%20a%20student%20ticket%20for%20WhatTheStack%202026.%0A%0AMy%20details%3A%0AName%3A%20%5BYOUR%20NAME%5D%0AUniversity%2FInstitution%3A%20%5BYOUR%20INSTITUTION%5D",
  };

  // Combine properly - put student ticket last effectively
  return [...apiReleases, studentTicket];
};

export default function Tickets() {
  const [releases] = createResource<HiEventsRelease[]>(fetchReleases);

  return (
    <Layout
      title="Tickets - WhatTheStack 2026"
      description="Get your tickets for WhatTheStack 2026 conference"
    >
      <div class="container mx-auto relative">
        <div class="absolute inset-0 scanline z-10"></div>
        <div class="max-w-7xl mx-auto text-center relative z-20">
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
              <div class="flex-wrap md:flex-nowrap flex justify-center gap-8 mb-12 fade-in-delay-2">
                <For each={releases()}>
                  {(release, index) => (
                    <div
                      class={`w-full max-w-sm bg-base-200/70 backdrop-blur-sm border border-primary-500/30 rounded-lg p-8 transform transition duration-300 hover:scale-105 hover-pulse grid-scan flex flex-col ${release.title === "Conference entry" ? "border-2 border-primary-500 relative shadow-[0_0_20px_rgba(var(--color-primary-500),0.3)]" : ""}`}
                    >
                      <h2 class="text-3xl font-star text-primary-500 mb-6">
                        {release.title}
                      </h2>
                      <div class="text-5xl font-star text-secondary-300 mb-6">
                        {release.price !== null ? `€${release.price}` : "FREE"}
                      </div>

                      {/* Description Area - Flex grow to push button down */}
                      <div class="flex-grow">
                        <div
                          class="text-secondary-300 mb-8 text-left text-lg leading-relaxed"
                          innerHTML={
                            release.description ||
                            "Available for the conference"
                          }
                        ></div>

                        <Show when={release.title === "Student Ticket"}>
                          <div class="text-sm text-secondary-400/80 italic mb-4 text-left border-l-2 border-primary-500 pl-3">
                            * Requires valid student ID verification via email.
                            Otherwise identical to regular ticket.
                          </div>
                        </Show>
                      </div>

                      <a
                        href={release.purchase_link}
                        target={
                          release.purchase_link.startsWith("mailto")
                            ? "_self"
                            : "_blank"
                        }
                        rel="noopener noreferrer"
                        class="btn btn-primary w-full font-star tracking-wider text-base-100 neon-glow hover-pulse text-xl py-4 h-auto"
                      >
                        {release.purchase_link.startsWith("mailto")
                          ? "APPLY NOW"
                          : "GET TICKET"}
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

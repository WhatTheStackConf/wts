import { Title } from "@solidjs/meta";
import { Layout } from "../layouts/Layout";
import { fetchHiEventsReleases, HiEventsRelease } from "../lib/hievents";
import { createResource, Show, For } from "solid-js";
import { HologramButton } from "../components/HologramButton";

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

  const baseTickets = () =>
    releases()?.filter(
      (r) => r.title === "Conference entry" || r.title === "Student Ticket",
    ) || [];

  const addOns = () =>
    releases()?.filter(
      (r) => r.title !== "Conference entry" && r.title !== "Student Ticket",
    ) || [];

  return (
    <Layout
      title="Tickets - WhatTheStack 2026"
      description="Get your tickets for WhatTheStack 2026 conference"
    >
      <div class="container mx-auto relative cursor-default">
        <div class="absolute inset-0 scanline z-10"></div>
        <div class="max-w-7xl mx-auto text-center relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-4 neon-glow fade-in">
            Conference Tickets
          </h1>
          <p class="text-xl  mb-12 fade-in-delay-1">
            Secure your place at the future of software development
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
              {/* Base Tickets */}
              <div class="flex flex-wrap justify-center gap-8 mb-20 fade-in-delay-2">
                <For each={baseTickets()}>
                  {(release, index) => (
                    <div
                      class={`w-full max-w-sm bg-base-200/70 backdrop-blur-sm border border-primary-500/30 rounded-lg p-8 transform transition duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(var(--color-primary-500),0.6)] grid-scan flex flex-col ${release.title === "Conference entry" ? "border-2 border-primary-500 relative shadow-[0_0_20px_rgba(var(--color-primary-500),0.3)]" : ""}`}
                    >
                      <h2 class="text-2xl font-star text-primary-500 mb-6 font-bold uppercase tracking-wider">
                        {release.title}
                      </h2>
                      <div class="text-6xl font-star mb-8 font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400">
                        {release.price !== null ? (
                          <>
                            <span class="font-sans font-bold text-4xl align-top">
                              €
                            </span>
                            {release.price}
                          </>
                        ) : (
                          "FREE"
                        )}
                      </div>

                      {/* Description Area - Flex grow to push button down */}
                      <div class="flex-grow">
                        <div
                          class="text-secondary-100 mb-8 text-left text-lg leading-relaxed prose prose-invert"
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

                      <HologramButton
                        href={release.purchase_link}
                        target={
                          release.purchase_link.startsWith("mailto")
                            ? "_self"
                            : "_blank"
                        }
                        rel="noopener noreferrer"
                        text={
                          release.purchase_link.startsWith("mailto")
                            ? "APPLY NOW"
                            : "GET TICKET"
                        }
                        class="w-full text-xl py-4 h-auto neon-glow mt-4"
                      />
                    </div>
                  )}
                </For>
              </div>

              {/* Add-ons Section */}
              <Show when={addOns().length > 0}>
                <div class="flex flex-col items-center justify-center fade-in-delay-4 w-screen ml-[calc(50%-50vw)] relative pt-20 pb-20 -mb-20 border-t border-white/10 bg-black/30 backdrop-blur-md shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
                  {/* Background separation gradient */}
                  <div class="absolute inset-0 bg-gradient-to-b from-black/50 to-transparent pointer-events-none -z-10 h-32"></div>

                  <div class="container mx-auto text-center px-4 flex flex-col items-center justify-center">
                    <h3 class="text-3xl font-star text-secondary-300 mb-2 neon-glow-subtle">
                      Enhance Your Experience
                    </h3>
                    <p class="text-secondary-400 mb-10 text-lg">
                      Extras available during checkout!
                    </p>

                    <div class="flex flex-wrap justify-center gap-6">
                      <For each={addOns()}>
                        {(release) => (
                          <div class="w-full max-w-xs bg-dark-800/40 backdrop-blur-sm border border-secondary-500/20 rounded-lg p-6 flex flex-col items-center hover:bg-dark-800/60 transition-colors">
                            <h4 class="text-xl font-star text-secondary-200 mb-3 font-bold uppercase tracking-wide">
                              {release.title.replace(" add-on", "")}
                            </h4>
                            <div class="text-3xl font-star mb-4 text-white">
                              <span class="font-sans font-bold text-xl align-top opacity-60">
                                €
                              </span>
                              {release.price}
                            </div>
                            <div
                              class="text-secondary-400 text-sm mb-4 leading-relaxed"
                              innerHTML={release.description || ""}
                            />

                            {/*<div class="text-xs text-secondary-500 uppercase tracking-widest border border-secondary-500/20 px-3 py-1 rounded">
                              Add-on Option
                            </div>*/}
                          </div>
                        )}
                      </For>
                    </div>

                    <p class="py-10 w-[400px]">
                      Volume discounts and payment via invoice available as
                      well. Send an email to{" "}
                      <a
                        class="text-primary-200 hover:text-primary-100"
                        href="mailto:what@wts.sh"
                      >
                        what@wts.sh
                      </a>{" "}
                      for more information.
                    </p>
                  </div>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </Layout>
  );
}

import { Layout } from "../layouts/Layout";
import { fetchHiEventsReleases, HiEventsRelease } from "../lib/hievents";
import { Show, For } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { HologramButton } from "../components/HologramButton";
import { conferenceGuideContent } from "~/lib/conference-guide-content";

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
    price: conferenceGuideContent.tickets.student.amount,
    currency: conferenceGuideContent.tickets.student.currency,
    is_available: true,
    sales_start_date: null,
    sales_end_date: null,
    quantity_sold: 0,
    quantity_available: null,
    purchase_link:
      `mailto:${conferenceGuideContent.tickets.student.verificationEmail}?subject=Student%20Ticket%20Verification&body=Hello%2C%0A%0AI%20would%20like%20to%20apply%20for%20a%20student%20ticket%20for%20WhatTheStack%202026.%0A%0AMy%20details%3A%0AName%3A%20%5BYOUR%20NAME%5D%0AUniversity%2FInstitution%3A%20%5BYOUR%20INSTITUTION%5D`,
  };

  // Combine properly - put student ticket last effectively
  return [...apiReleases, studentTicket];
};

function plainText(value: string | null): string {
  return value?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || "Optional conference extra.";
}

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

  const conferenceTicketLink = () =>
    baseTickets().find((release) => release.title === "Conference entry")
      ?.purchase_link;

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
            One regular ticket, one student ticket, and no early-bird maze.
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
                    Tickets aren't loading
                  </div>
                  <p class="text-secondary-300">
                    Reload the page, or email{" "}
                    <a
                      href={`mailto:${conferenceGuideContent.contact.generalEmail}`}
                      class="text-primary-200 hover:text-primary-100"
                    >
                      {conferenceGuideContent.contact.generalEmail}
                    </a>{" "}
                    if it keeps failing.
                  </p>
                </div>
              }
            >
              {/* Base Tickets */}
              <div class="flex flex-wrap justify-center gap-8 mb-20 fade-in-delay-2">
                <For each={baseTickets()}>
                  {(release) => (
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
                      The optional bits
                    </h3>
                    <p class="text-secondary-400 mb-10 text-lg">
                      Workshops, swag, and other extras are available at checkout.
                    </p>

                    <div class="grid w-full max-w-4xl gap-3 text-left">
                      <For each={addOns()}>
                        {(release) => (
                          <article class="group grid gap-4 overflow-hidden rounded-none border border-dashed border-secondary-500/40 bg-base-200/55 p-4 transition-colors hover:border-secondary-400/80 hover:bg-base-200/80 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                            <div class="min-w-0">
                              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <span class="font-mono text-[0.65rem] font-bold uppercase tracking-[0.18em] text-secondary-400">
                                  Add-on
                                </span>
                                <h4 class="font-star text-lg font-bold uppercase tracking-wide text-secondary-200">
                                  {release.title.replace(" add-on", "")}
                                </h4>
                                <span class="font-star text-2xl text-white">
                                  <span class="font-sans text-base font-bold text-white/60">€</span>{release.price}
                                </span>
                              </div>
                              <p class="mt-1 line-clamp-2 text-sm leading-relaxed text-secondary-300">
                                {plainText(release.description)}
                              </p>
                            </div>
                            <a
                                href={conferenceTicketLink() || release.purchase_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="week-entry-cta justify-center whitespace-nowrap sm:min-w-40"
                              >
                                View ticket options <span aria-hidden="true">&#8599;</span>
                            </a>
                          </article>
                        )}
                      </For>
                    </div>

                    <p class="py-10 w-[400px]">
                      Bringing a team or need an invoice? Email{" "}
                      <a
                        class="text-primary-200 hover:text-primary-100"
                        href={`mailto:${conferenceGuideContent.contact.generalEmail}`}
                      >
                        {conferenceGuideContent.contact.generalEmail}
                      </a>{" "}
                      and we'll sort it out.
                    </p>

                    <p class="text-secondary-300 text-sm">
                      Need to justify the trip?{" "}
                      <a
                        href="/convince-your-boss"
                        class="text-primary-400 hover:text-primary-300 hover:underline transition-colors"
                      >
                        Convince your boss
                      </a>
                      . We wrote the email for you.
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

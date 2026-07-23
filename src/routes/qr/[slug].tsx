import { useParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import { HologramButton } from "~/components/HologramButton";
import { PromoLayout } from "~/layouts/PromoLayout";
import { resolveQrDiscount } from "~/lib/qr-discounts";
import NotFound from "~/routes/[...404]";

export default function QrDiscountRoute() {
  const params = useParams();
  const discount = createMemo(() => resolveQrDiscount(params.slug));

  return (
    <Show when={discount()} fallback={<NotFound />}>
      {(page) => (
        <PromoLayout
          title={`${page().title} | WhatTheStack`}
          description={`${page().lead} Unlock ${page().discountPercentage}% off a WhatTheStack 2026 ticket.`}
          ogSubtitle={`${page().discountPercentage}% off // WhatTheStack 2026`}
        >
          <article class="mx-auto flex w-full max-w-3xl flex-col items-center text-center text-white">
            <a
              href="/"
              class="mb-8 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-300"
              aria-label="WhatTheStack home"
            >
              <img
                src="/favicon.svg"
                width="72"
                height="72"
                alt=""
                fetchpriority="high"
              />
            </a>

            <p class="mb-4 font-mono text-sm text-primary-300">
              qr://{page().slug}
            </p>
            <h1 class="max-w-2xl text-balance font-star text-4xl font-bold leading-tight text-white sm:text-6xl">
              {page().title}
            </h1>
            <p class="mt-7 max-w-2xl text-pretty text-xl font-semibold leading-relaxed text-secondary-100 sm:text-2xl">
              {page().lead}
            </p>
            <p class="mt-3 max-w-[65ch] text-pretty text-base leading-relaxed text-secondary-300 sm:text-lg">
              {page().body}
            </p>

            <section
              class="relative mt-10 w-full max-w-sm border-2 border-dashed border-primary-400 bg-dark-900 px-7 py-8"
              aria-labelledby="qr-discount-heading"
            >
              <h2 id="qr-discount-heading" class="sr-only">
                Ticket discount
              </h2>
              <p class="font-star text-6xl font-black leading-none text-primary-300">
                {page().discountPercentage}%
              </p>
              <p class="mt-2 text-xl font-bold text-white">off your ticket</p>
              <HologramButton
                href={page().checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Use ${page().discountPercentage}% discount`}
                text={`Use ${page().discountPercentage}% discount`}
                class="mt-7 min-h-12 w-full px-5 py-3"
              />
            </section>

            <p class="mt-7 max-w-lg text-pretty text-sm leading-relaxed text-secondary-400">
              Found one of our original stickers? It still works. The offer is
              now valid for WhatTheStack 2026.
            </p>
          </article>
        </PromoLayout>
      )}
    </Show>
  );
}

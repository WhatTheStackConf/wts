import { Icon } from "@iconify-icon/solid";
import { For, Show } from "solid-js";
import Logo from "~/assets/images/LogoSolo.svg?component-solid";
import { SpeakerAvatar } from "~/components/conference/SpeakerAvatar";
import type { PublicSpeakerPromo } from "~/lib/speakers-public";

interface SpeakerPromoPageProps {
  promo: PublicSpeakerPromo;
}

/** Append Iconify arrow unless the label already includes one. */
function promoCtaShowsIcon(label: string): boolean {
  return !/(?:→|->|➔|➜|›|»)/.test(label);
}

export function SpeakerPromoPage(props: SpeakerPromoPageProps) {
  return (
    <div class="w-full max-w-xl mx-auto flex flex-col items-center text-center">
      <div
        class="h-20 w-20 sm:h-24 sm:w-24 mb-6 md:mb-8 flex items-center justify-center filter drop-shadow-[0_0_15px_rgba(46,200,254,0.4)]"
        aria-hidden="true"
      >
        <Logo class="w-full h-full" />
      </div>

      <h1 class="font-star italic text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-10 md:mb-12 leading-tight neon-glow-subtle">
        <span class="text-secondary-300">What</span>
        <span class="text-primary-500">The</span>
        <span class="text-secondary-300">Stack</span>
        <span class="text-primary-400">!?!</span>
      </h1>

      <div class="w-full rounded-2xl border border-white/10 bg-dark-900/80 backdrop-blur-sm px-6 py-6 sm:px-8 sm:py-8 mb-10 md:mb-12 shadow-[0_0_40px_rgba(0,0,0,0.45)]">
        <div class="flex flex-col sm:flex-row items-center sm:items-center gap-6 sm:gap-8 text-left w-full">
          <div class="shrink-0">
            <SpeakerAvatar
              name={props.promo.displayName}
              photoUrl={props.promo.photoUrl}
              size="promo"
            />
          </div>
          <div class="min-w-0 flex-1 text-center sm:text-left">
            <p class="text-2xl sm:text-3xl font-bold text-white leading-tight">
              {props.promo.displayName}
            </p>
            <p class="mt-1.5 text-base sm:text-lg text-dark-50/70">
              {props.promo.roleLine}
            </p>
            <p class="mt-3 font-mono text-sm sm:text-base text-secondary-400">
              {props.promo.statusMessage}
            </p>
          </div>
        </div>
      </div>

      <Show when={props.promo.stack.length > 0}>
        <section class="w-full mb-10 md:mb-12">
          <p class="font-mono text-sm text-dark-50/50 mb-4 text-left sm:text-center">
            {"// the stack powering this page"}
          </p>
          <ul class="flex flex-wrap justify-center gap-2.5 list-none p-0 m-0">
            <For each={props.promo.stack}>
              {(tag) => (
                <li>
                  <span
                    class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium bg-dark-900/60"
                    style={{
                      color: tag.color,
                      "border-color": `color-mix(in srgb, ${tag.color} 45%, transparent)`,
                    }}
                  >
                    <span
                      class="w-2 h-2 rounded-full shrink-0"
                      style={{ "background-color": tag.color }}
                      aria-hidden="true"
                    />
                    {tag.name}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <a
        href={props.promo.ctaHref}
        class="w-full max-w-md btn btn-lg rounded-full border-0 text-white font-semibold text-base sm:text-lg bg-primary-500 hover:bg-primary-400 shadow-[0_0_32px_color-mix(in_oklch,var(--color-primary-500)_55%,transparent)] transition-all duration-300 inline-flex items-center justify-center gap-2"
      >
        {props.promo.ctaLabel}
        <Show when={promoCtaShowsIcon(props.promo.ctaLabel)}>
          <Icon
            icon="material-symbols:arrow-forward"
            class="shrink-0 text-[1.15em] leading-none"
            aria-hidden="true"
          />
        </Show>
      </a>

      <p class="mt-10 md:mt-12 text-xs sm:text-sm text-dark-50/95 max-w-md leading-relaxed">
        {props.promo.footerText}
        <For each={props.promo.footerLinks}>
          {(link, index) => (
            <>
              <Show when={index() > 0}>
                <span> </span>
              </Show>
              <a
                href={link.href}
                class="underline underline-offset-2 hover:opacity-90 transition-opacity"
              style={{ color: link.color }}
              target={link.href.startsWith("http") ? "_blank" : undefined}
              rel={
                link.href.startsWith("http") ? "noopener noreferrer" : undefined
              }
              >
                {link.label}
              </a>
            </>
          )}
        </For>
        {props.promo.footerSuffix}
      </p>
    </div>
  );
}

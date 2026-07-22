import { createMemo, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { HologramButton } from "~/components/HologramButton";
import type { PublicPartner, PublicPartnerGroup } from "~/lib/partners-public";

interface PartnersShowcaseProps {
  groups: PublicPartnerGroup[];
  variant?: "home" | "page";
}

interface PartnerLogoProps {
  partner: PublicPartner;
  group: PublicPartnerGroup;
}

function groupToneClass(group: PublicPartnerGroup): string {
  switch (group.id) {
    case "platinum-sponsors":
      return "text-primary-200 border-primary-300/60";
    case "gold-sponsors":
      return "text-yellow-300 border-yellow-300/60";
    case "silver-sponsors":
      return "text-slate-200 border-slate-200/50";
    case "bronze-sponsors":
      return "text-amber-500 border-amber-500/50";
    case "organizers":
      return "text-primary-300 border-primary-400/50";
    default:
      return "text-secondary-300 border-secondary-400/45";
  }
}

function groupGridClass(group: PublicPartnerGroup, variant: "home" | "page"): string {
  if (group.tier === "platinum") {
    return variant === "page"
      ? "grid-cols-1 md:grid-cols-2"
      : "grid-cols-1 sm:grid-cols-2";
  }
  if (group.tier === "gold") {
    return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  }
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
}

function showcaseSpacingClass(variant: "home" | "page"): string {
  if (variant === "page") return "space-y-8 md:space-y-10";
  return "space-y-6 md:space-y-8";
}

function logoCardClass(group: PublicPartnerGroup): string {
  let size = "min-h-[10rem] p-3";
  if (group.tier === "gold") size = "min-h-[12rem] p-3.5 md:p-4";
  if (group.tier === "platinum") size = "min-h-[14rem] p-4 md:p-5";

  return `partner-logo-card group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border no-underline ${size} ${groupToneClass(group)}`;
}

function logoStageClass(group: PublicPartnerGroup): string {
  if (group.tier === "platinum") return "h-36";
  if (group.tier === "gold") return "h-28";
  return "h-24";
}

function PartnerLogo(props: PartnerLogoProps) {
  const component = () => (props.partner.url ? "a" : "div");

  return (
    <Dynamic
      component={component()}
      href={props.partner.url}
      target={props.partner.url ? "_blank" : undefined}
      rel={props.partner.url ? "noopener noreferrer" : undefined}
      class={logoCardClass(props.group)}
    >
      <span class="cyber-scan-line" aria-hidden="true" />
      <span class={`partner-logo-stage relative z-10 flex w-full items-center justify-center overflow-hidden rounded-xl ${logoStageClass(props.group)}`}>
        <img
          src={props.partner.logoUrl}
          alt=""
          width={320}
          height={160}
          loading="lazy"
          class="partner-logo-image block h-full w-full object-contain p-2"
        />
      </span>
      <span class="relative z-10 mt-3 flex w-full min-w-0 items-center gap-3 px-1">
        <span class="partner-logo-name min-w-0 flex-1">{props.partner.name}</span>
        <Show when={props.partner.url}>
          <span class="partner-logo-arrow shrink-0" aria-hidden="true">&#8599;</span>
        </Show>
      </span>
      <span class="partner-card-activation pointer-events-none absolute inset-x-0 bottom-0 h-px" aria-hidden="true" />
    </Dynamic>
  );
}

export function PartnersShowcaseSkeleton() {
  return (
    <div class="w-full max-w-6xl mx-auto px-3 md:px-0 py-10" aria-hidden="true">
      <div class="glass-panel rounded-3xl p-8 md:p-10">
        <div class="h-7 w-52 bg-primary-500/15 animate-pulse mb-8" />
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <For each={[0, 1, 2, 3]}>
            {() => <div class="h-32 rounded-2xl bg-base-300/80 border border-white/10 animate-pulse" />}
          </For>
        </div>
      </div>
    </div>
  );
}

export function PartnersShowcase(props: PartnersShowcaseProps) {
  const variant = () => props.variant ?? "page";
  const visibleGroups = createMemo(() =>
    props.groups.filter((group) => group.partners.length > 0),
  );

  return (
    <section class="w-full max-w-6xl mx-auto px-3 md:px-0">
      <div class={showcaseSpacingClass(variant())}>
        <Show
          when={visibleGroups().length > 0}
          fallback={
            <div class="glass-panel grid-scan rounded-3xl p-8 md:p-10 text-center">
              <p class="font-mono text-sm uppercase tracking-[0.3em] text-accent-300 mb-4">
                Awaiting signal
              </p>
              <h2 class="font-star text-3xl md:text-4xl uppercase tracking-widest text-primary-300 mb-4">
                Sponsors and partners announce soon
              </h2>
              <p class="max-w-2xl mx-auto text-dark-50 text-lg leading-relaxed mb-8">
                We are lining up the companies, communities, media crews, and food-and-coffee humans who help make WTS feel like WTS.
              </p>
              <div class="flex justify-center">
                <HologramButton href="/partnerships" text="Partner with us" class="px-7 py-3" />
              </div>
            </div>
          }
        >
          <For each={visibleGroups()}>
            {(group) => (
              <section class="glass-panel grid-scan rounded-3xl p-6 md:p-8 lg:p-10">
                <div class="relative z-30 mb-6 md:mb-8">
                  <p class="font-mono text-xs uppercase tracking-[0.28em] text-accent-300 mb-3">
                    <Show when={group.kind === "sponsor"} fallback="Conference network">
                      Sponsor tier
                    </Show>
                  </p>
                  <h3 class={`font-star text-2xl md:text-4xl uppercase tracking-widest ${groupToneClass(group).split(" ")[0]}`}>
                    {group.title}
                  </h3>
                </div>

                <ul class={`relative z-30 grid gap-4 md:gap-5 list-none p-0 m-0 ${groupGridClass(group, variant())}`}>
                  <For each={group.partners}>
                    {(partner) => (
                      <li class="min-w-0 h-full">
                        <PartnerLogo partner={partner} group={group} />
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}

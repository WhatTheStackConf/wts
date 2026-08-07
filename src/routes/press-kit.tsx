import { Link } from "@solidjs/meta";
import { For, Match, Show, Switch, createSignal, onCleanup, type JSX } from "solid-js";
import Logo from "~/assets/images/LogoSolo.svg";
import {
  formatPressKitGradient,
  pressKitAllFacts,
  pressKitDescription,
  pressKitFacts,
  pressKitGradients,
  pressKitUsageGuidance,
  pressKitCanonicalUrl,
} from "~/lib/press-kit";
import { getSiteOrigin } from "~/lib/site-url";
import { Layout } from "~/layouts/Layout";

const assetPath = "/press-kit";

interface CopyButtonProps {
  value: string;
  label: string;
  ariaLabel?: string;
}

function CopyButton(props: CopyButtonProps) {
  const [copied, setCopied] = createSignal(false);
  let resetTimer: number | undefined;

  onCleanup(() => {
    if (resetTimer) window.clearTimeout(resetTimer);
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
    } catch {
      return;
    }

    if (resetTimer) window.clearTimeout(resetTimer);
    setCopied(true);
    resetTimer = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      class="btn btn-ghost btn-sm min-h-10 shrink-0 text-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300"
      aria-label={props.ariaLabel}
      onClick={() => void copy()}
    >
      <span aria-live="polite" aria-atomic="true">
        {copied() ? "Copied" : props.label}
      </span>
    </button>
  );
}

interface GuidanceTextProps {
  children: string;
}

function GuidanceText(props: GuidanceTextProps): JSX.Element {
  const parts = () => props.children.split(/(https:\/\/wts\.sh|what@wts\.sh)/g);

  return (
    <For each={parts()}>
      {(part) => (
        <Switch fallback={part}>
          <Match when={part === "https://wts.sh"}><a class="link text-primary-200" href={part}>{part}</a></Match>
          <Match when={part === "what@wts.sh"}><a class="link text-primary-200" href={`mailto:${part}`}>{part}</a></Match>
        </Switch>
      )}
    </For>
  );
}

export default function PressKit() {
  return (
    <Layout
      title="Press Kit | WhatTheStack 2026"
      description="Download approved WhatTheStack 2026 assets and read usage guidance for Media and Partners."
      ogSubtitle="Approved assets and usage guidance for Media and Partners"
    >
      <Link rel="canonical" href={pressKitCanonicalUrl(getSiteOrigin())} />

      <article class="press-kit-page w-full max-w-7xl px-4 pb-28">
        <header class="border-b-2 border-primary-500 pb-9">
          <div class="flex flex-wrap items-end justify-between gap-8">
            <div class="min-w-0">
              <p class="font-mono text-sm font-bold text-secondary-300">Public reference · 2026 edition</p>
              <h1 class="mt-3 text-balance font-star text-5xl font-bold uppercase leading-tight tracking-[0.04em] text-primary-300 md:text-7xl">
                Press Kit
              </h1>
              <p class="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-dark-50">
                For Media and Partners. No advance approval is needed for the uses described here.
              </p>
            </div>
            <a
              class="btn btn-primary min-h-12"
              href={`${assetPath}/wts-press-kit-2026.zip`}
              download="wts-press-kit-2026.zip"
              aria-label="Download complete kit: wts-press-kit-2026.zip"
            >
              Download complete kit
            </a>
          </div>
        </header>

        <div class="grid gap-12 pt-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside class="lg:sticky lg:top-6 lg:self-start">
            <nav aria-label="Press Kit contents" class="border-y border-white/20 py-5">
              <p class="mb-3 font-bold text-white">On this page</p>
              <ol class="grid gap-1 text-sm">
                <li><a class="link block min-h-10 py-2 text-primary-200" href="#overview">Overview</a></li>
                <li><a class="link block min-h-10 py-2 text-primary-200" href="#downloads">Downloads</a></li>
                <li><a class="link block min-h-10 py-2 text-primary-200" href="#facts">Facts and copy</a></li>
                <li><a class="link block min-h-10 py-2 text-primary-200" href="#gradients">Logo gradients</a></li>
                <li><a class="link block min-h-10 py-2 text-primary-200" href="#guidance">Usage guidance</a></li>
              </ol>
            </nav>
          </aside>

          <div class="min-w-0">
            <section id="overview" aria-labelledby="overview-title" class="scroll-mt-8 grid gap-8 md:grid-cols-[minmax(0,1fr)_15rem] md:items-start">
              <div>
                <h2 id="overview-title" class="max-w-3xl text-balance text-3xl font-bold leading-tight text-white md:text-4xl">
                  WhatTheStack 2026, ready to reference
                </h2>
                <p class="mt-5 max-w-3xl text-pretty text-xl leading-relaxed text-dark-50">
                  {pressKitDescription}
                </p>
                <div class="mt-3">
                  <CopyButton value={pressKitDescription} label="Copy description" />
                </div>
              </div>
              <figure class="grid min-h-64 place-items-center border border-white/20 bg-dark-900/95 p-8">
                <div class="h-48 w-40 [&>svg]:h-full [&>svg]:w-full" aria-hidden="true">
                  <Logo />
                </div>
                <figcaption class="sr-only">Approved WhatTheStack 2026 standalone logo mark preview</figcaption>
              </figure>
            </section>

            <section id="downloads" aria-labelledby="downloads-title" class="mt-16 scroll-mt-8 border-t border-white/20 pt-9">
              <div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div>
                  <h2 id="downloads-title" class="font-star text-3xl uppercase tracking-[0.04em] text-secondary-300">Downloads</h2>
                  <p class="mt-3 max-w-3xl text-pretty leading-relaxed text-dark-50">
                    Download the approved WhatTheStack 2026 mark as an individual file or get both formats in one archive. The archive contains the same SVG and PNG offered below, with no extra reference files.
                  </p>
                </div>
                <a
                  class="btn btn-primary min-h-12"
                  href={`${assetPath}/wts-press-kit-2026.zip`}
                  download="wts-press-kit-2026.zip"
                  aria-label="Download all · ZIP: wts-press-kit-2026.zip"
                >
                  Download all · ZIP
                </a>
              </div>

              <div class="mt-7 divide-y divide-white/20 border-y border-white/20">
                <div class="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div class="min-w-0">
                    <strong class="block break-all font-mono text-base text-white sm:text-lg">wts-logo-mark-2026.svg</strong>
                    <p class="mt-1 text-sm text-dark-50">Original vector · transparent background</p>
                  </div>
                  <a
                    class="btn btn-outline btn-primary min-h-11 justify-self-start"
                    href={`${assetPath}/wts-logo-mark-2026.svg`}
                    download="wts-logo-mark-2026.svg"
                    aria-label="Download SVG: wts-logo-mark-2026.svg"
                  >
                    Download SVG
                  </a>
                </div>
                <div class="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div class="min-w-0">
                    <strong class="block break-all font-mono text-base text-white sm:text-lg">wts-logo-mark-2026.png</strong>
                    <p class="mt-1 text-sm text-dark-50">1024 × 1301 · transparent background</p>
                  </div>
                  <a
                    class="btn btn-outline btn-primary min-h-11 justify-self-start"
                    href={`${assetPath}/wts-logo-mark-2026.png`}
                    download="wts-logo-mark-2026.png"
                    aria-label="Download PNG: wts-logo-mark-2026.png"
                  >
                    Download PNG
                  </a>
                </div>
              </div>
            </section>

            <section id="facts" aria-labelledby="facts-title" class="mt-16 scroll-mt-8 border-t border-white/20 pt-9">
              <div class="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 id="facts-title" class="font-star text-3xl uppercase tracking-[0.04em] text-primary-300">Facts and copy</h2>
                  <p class="mt-3 max-w-3xl text-pretty leading-relaxed text-dark-50">
                    Stable public details for WhatTheStack 2026. Copy individual values or all facts at once.
                  </p>
                </div>
                <CopyButton value={pressKitAllFacts} label="Copy all facts" />
              </div>

              <ul class="mt-7 divide-y divide-white/20 border-y border-white/20">
                <For each={pressKitFacts}>
                  {(fact) => (
                    <li class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 py-4 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center">
                      <span class="col-span-2 text-sm font-medium text-dark-50 sm:col-span-1">{fact.label}</span>
                      <span class="min-w-0 break-words font-medium text-white [overflow-wrap:anywhere]">
                        <Show when={"href" in fact} fallback={fact.value}>
                          <a class="link text-primary-100" href={"href" in fact ? fact.href : undefined}>{fact.value}</a>
                        </Show>
                      </span>
                      <CopyButton value={fact.value} label="Copy" ariaLabel={`Copy ${fact.label}`} />
                    </li>
                  )}
                </For>
              </ul>
            </section>

            <section id="gradients" aria-labelledby="gradients-title" class="mt-16 scroll-mt-8 border-t border-white/20 pt-9">
              <h2 id="gradients-title" class="font-star text-3xl uppercase tracking-[0.04em] text-secondary-300">Logo gradients</h2>
              <p class="mt-3 max-w-3xl text-pretty leading-relaxed text-dark-50">
                Use these exact gradient pairs as WhatTheStack 2026 promotional accents. They are not a complete brand palette.
              </p>
              <div class="mt-7 grid gap-x-10 gap-y-7 sm:grid-cols-2">
                <For each={pressKitGradients}>
                  {(gradient) => {
                    const value = formatPressKitGradient(gradient);
                    return (
                      <div class="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-center gap-4">
                        <div
                          class="h-16 border border-white/20"
                          style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }}
                          aria-hidden="true"
                        />
                        <div class="min-w-0">
                          <p class="break-words font-mono text-sm font-bold text-white [overflow-wrap:anywhere]">{value}</p>
                          <CopyButton value={value} label="Copy gradient" ariaLabel={`Copy gradient ${gradient.from} to ${gradient.to}`} />
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </section>

            <section id="guidance" aria-labelledby="guidance-title" class="mt-16 scroll-mt-8 border-t border-white/20 pt-9">
              <h2 id="guidance-title" class="font-star text-3xl uppercase tracking-[0.04em] text-primary-300">Usage guidance</h2>
              <p class="mt-3 max-w-3xl text-pretty leading-relaxed text-dark-50">
                Media and Partners may use these materials without advance approval within the boundaries below.
              </p>
              <div class="mt-7 grid gap-8 xl:grid-cols-[minmax(0,1fr)_17rem]">
                <ul class="divide-y divide-white/20 border-y border-white/20">
                  <For each={pressKitUsageGuidance}>
                    {(item) => (
                      <li class="py-5">
                        <h3 class="text-lg font-bold text-white">{item.heading}</h3>
                        <p class="mt-2 max-w-3xl text-pretty leading-relaxed text-dark-50">
                          <GuidanceText>{item.body}</GuidanceText>
                        </p>
                      </li>
                    )}
                  </For>
                </ul>
                <aside class="self-start border border-primary-500/60 bg-dark-900/95 p-5">
                  <h3 class="text-lg font-bold text-white">Outside these uses?</h3>
                  <a class="link mt-4 block break-words font-bold text-primary-200 [overflow-wrap:anywhere]" href="mailto:what@wts.sh">what@wts.sh</a>
                </aside>
              </div>
            </section>
          </div>
        </div>
      </article>
    </Layout>
  );
}

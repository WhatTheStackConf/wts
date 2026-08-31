// PROTOTYPE ONLY: three Press Kit structures, switchable via ?variant=A|B|C.
import { useSearchParams } from "@solidjs/router";
import { For, Show, createSignal, onSettled } from "solid-js";
import logoUrl from "../../assets/images/LogoSolo.svg";
import { Layout } from "../../layouts/Layout";

const gradients = [
  { name: "Signal blue", from: "#91F6FF", to: "#2EC8FE" },
  { name: "Heat", from: "#FFC03D", to: "#FE7457" },
  { name: "Pulse", from: "#FEA403", to: "#CD3DD0" },
  { name: "Spectrum", from: "#25DBFA", to: "#A240FE" },
];

const facts = [
  ["Edition", "WhatTheStack 2026"],
  ["Date", "2026-09-19"],
  ["Location", "Skopje, North Macedonia"],
  ["Venue", "Technical Campus"],
  ["Organizers", "DeveD, Base42, Angular Macedonia"],
  ["Contact", "what@wts.sh"],
] as const;

const description =
  "WhatTheStack is a single-day, multi-track conference celebrating technology, the web platform, AI, infrastructure, and everything else that makes the modern stack what it is.";

const usageRules = [
  "Media may use these materials for editorial coverage without advance approval.",
  "Partners may promote their actual WhatTheStack 2026 involvement without advance approval.",
  "Use “WhatTheStack 2026” on first mention, then “WhatTheStack” or “WTS” where clear.",
  "Keep the supplied mark unchanged: resize proportionally, but do not crop, rotate, recolor, redraw, merge, or add effects.",
  "Keep event facts accurate and describe only the actual Partner relationship.",
];

function LogoStage(props: { compact?: boolean }) {
  return (
    <div class={`relative grid place-items-center overflow-hidden border border-white/15 bg-dark-900/95 ${props.compact ? "min-h-64 p-10" : "min-h-[28rem] p-14"}`}>
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,color-mix(in_oklch,var(--color-primary-500)_20%,transparent),transparent_55%)]" />
      <div class={`${props.compact ? "h-44 w-36" : "h-64 w-52"} relative [&>svg]:h-full [&>svg]:w-full`} aria-hidden="true">
        <img src={logoUrl} alt="" />
      </div>
    </div>
  );
}

function PrototypeAction(props: { label: string; detail: string; primary?: boolean }) {
  const [status, setStatus] = createSignal("");

  return (
    <div class="min-w-0">
      <button
        type="button"
        class={props.primary ? "btn btn-primary min-h-12" : "btn btn-outline btn-primary min-h-12"}
        onClick={() => setStatus(`${props.detail} would download in the production page.`)}
      >
        {props.label}
      </button>
      <p class="mt-2 min-h-5 max-w-xs text-xs text-base-content/70" aria-live="polite">
        {status()}
      </p>
    </div>
  );
}

function CopyButton(props: { value: string; label?: string }) {
  const [copied, setCopied] = createSignal(false);

  const copy = async () => {
    await navigator.clipboard.writeText(props.value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      class="btn btn-ghost btn-sm min-h-10 shrink-0 text-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300"
      onClick={copy}
    >
      {copied() ? "Copied" : props.label ?? "Copy"}
    </button>
  );
}

function GradientStrip(props: { gradient: (typeof gradients)[number]; vertical?: boolean }) {
  const value = `${props.gradient.from} → ${props.gradient.to}`;

  return (
    <div class={props.vertical ? "grid gap-3" : "flex min-w-0 items-center gap-4"}>
      <div
        class={`${props.vertical ? "h-24 w-full" : "h-14 w-24 shrink-0"} border border-white/20`}
        style={{ background: `linear-gradient(135deg, ${props.gradient.from}, ${props.gradient.to})` }}
        aria-hidden="true"
      />
      <div class="min-w-0">
        <p class="font-bold text-white">{props.gradient.name}</p>
        <p class="break-words font-mono text-sm text-base-content/75">
          {value}
        </p>
        <CopyButton value={value} label="Copy gradient" />
      </div>
    </div>
  );
}

function VariantA() {
  return (
    <article class="w-full max-w-6xl px-4 pb-28">
      <header class="grid items-end gap-10 border-b border-primary-500/45 pb-12 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <p class="mb-5 font-mono text-sm font-bold text-secondary-300">WhatTheStack 2026</p>
          <h1 class="max-w-4xl text-balance font-star text-5xl font-bold uppercase leading-[1.05] tracking-[0.04em] text-primary-300 md:text-7xl">
            Press Kit
          </h1>
          <p class="mt-6 max-w-2xl text-pretty text-xl leading-relaxed text-dark-50">
            Approved assets, stable event facts, and practical guidance for Media and Partners.
          </p>
        </div>
        <PrototypeAction label="Download all" detail="wts-press-kit-2026.zip" primary />
      </header>

      <section aria-labelledby="a-assets" class="grid gap-8 py-16 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <LogoStage />
        <div class="flex flex-col justify-between border-y border-white/15 py-8">
          <div>
            <h2 id="a-assets" class="text-balance font-star text-4xl uppercase tracking-[0.06em] text-secondary-300">Logo mark</h2>
            <p class="mt-4 text-pretty leading-relaxed text-dark-50">
              The approved standalone WhatTheStack 2026 mark on a transparent background. Use either supplied file unchanged.
            </p>
          </div>
          <div class="mt-10 grid gap-5">
            <div class="flex flex-wrap items-start justify-between gap-4 border-t border-white/15 pt-5">
              <div><strong class="block text-lg">SVG</strong><span class="text-sm text-base-content/65">Vector · transparent</span></div>
              <PrototypeAction label="Download SVG" detail="wts-logo-mark-2026.svg" />
            </div>
            <div class="flex flex-wrap items-start justify-between gap-4 border-t border-white/15 pt-5">
              <div><strong class="block text-lg">PNG</strong><span class="text-sm text-base-content/65">1024 × 1301 · transparent</span></div>
              <PrototypeAction label="Download PNG" detail="wts-logo-mark-2026.png" />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="a-facts" class="border-y border-white/15 py-14">
        <div class="grid gap-12 lg:grid-cols-[minmax(14rem,0.55fr)_minmax(0,1.45fr)]">
          <div>
            <h2 id="a-facts" class="font-star text-3xl uppercase tracking-[0.06em] text-primary-300">Event facts</h2>
            <p class="mt-4 text-dark-50">Ready to quote. Keep listed facts accurate.</p>
            <CopyButton value={description} label="Copy description" />
          </div>
          <dl class="grid sm:grid-cols-2">
            <For each={facts}>{([term, value]) => (
              <div class="border-t border-white/15 py-4 sm:odd:pr-6 sm:even:border-l sm:even:pl-6">
                <dt class="text-sm text-base-content/60">{term}</dt>
                <dd class="mt-1 flex items-start justify-between gap-3 font-medium text-white"><span>{value}</span><CopyButton value={value} /></dd>
              </div>
            )}</For>
          </dl>
        </div>
      </section>

      <section aria-labelledby="a-gradients" class="py-16">
        <h2 id="a-gradients" class="font-star text-3xl uppercase tracking-[0.06em] text-secondary-300">Logo gradients</h2>
        <p class="mt-3 max-w-2xl text-dark-50">Approved promotional accents, not a complete brand palette.</p>
        <div class="mt-9 grid gap-x-12 gap-y-8 md:grid-cols-2">
          <For each={gradients}>{gradient => <GradientStrip gradient={gradient} />}</For>
        </div>
      </section>

      <section aria-labelledby="a-guidance" class="bg-dark-900/95 p-7 md:p-12">
        <div class="grid gap-10 lg:grid-cols-[minmax(14rem,0.55fr)_minmax(0,1.45fr)]">
          <div>
            <h2 id="a-guidance" class="font-star text-3xl uppercase tracking-[0.06em] text-primary-300">Use it accurately</h2>
            <p class="mt-4 text-dark-50">No advance approval is needed inside these boundaries.</p>
          </div>
          <div>
            <ul class="divide-y divide-white/15 border-y border-white/15">
              <For each={usageRules}>{rule => <li class="py-4 leading-relaxed text-base-content/90">{rule}</li>}</For>
            </ul>
            <p class="mt-8 text-lg">Unsupported claim or use? <a class="link font-bold text-primary-200" href="mailto:what@wts.sh">what@wts.sh</a></p>
          </div>
        </div>
      </section>
    </article>
  );
}

function VariantB() {
  return (
    <article class="w-full max-w-6xl px-4 pb-28">
      <header class="mx-auto max-w-4xl text-center">
        <div class="mx-auto mb-8 h-28 w-24" aria-hidden="true"><img src={logoUrl} alt="" class="h-full w-full" /></div>
        <h1 class="text-balance font-star text-5xl font-bold uppercase tracking-[0.05em] text-primary-300 md:text-7xl">Press Kit 2026</h1>
        <p class="mx-auto mt-6 max-w-2xl text-pretty text-xl leading-relaxed text-dark-50">Start with what you’re making. Each path keeps the approved files and facts close to the guidance that applies.</p>
      </header>

      <section aria-labelledby="b-paths" class="mt-14">
        <h2 id="b-paths" class="sr-only">Choose your path</h2>
        <div class="grid gap-px bg-white/15 lg:grid-cols-2">
          <section class="bg-dark-900/95 p-7 md:p-10">
            <p class="font-mono text-sm font-bold text-secondary-300">For coverage</p>
            <h3 class="mt-3 text-3xl font-bold text-white">Media</h3>
            <p class="mt-4 max-w-lg text-pretty leading-relaxed text-dark-50">Quote the neutral description and verified facts, then download the approved mark for editorial coverage.</p>
            <div class="mt-8 flex flex-wrap gap-3"><CopyButton value={description} label="Copy event description" /><PrototypeAction label="Download logo files" detail="wts-press-kit-2026.zip" /></div>
          </section>
          <section class="bg-dark-900/95 p-7 md:p-10">
            <p class="font-mono text-sm font-bold text-accent-300">For accurate promotion</p>
            <h3 class="mt-3 text-3xl font-bold text-white">Partners</h3>
            <p class="mt-4 max-w-lg text-pretty leading-relaxed text-dark-50">Promote your actual WhatTheStack 2026 involvement using the supplied mark and gradients without implying a different relationship.</p>
            <div class="mt-8 flex flex-wrap gap-3"><PrototypeAction label="Download logo files" detail="wts-press-kit-2026.zip" /><a class="btn btn-ghost min-h-12 text-primary-200" href="#b-guidance">Check usage rules</a></div>
          </section>
        </div>
      </section>

      <section aria-labelledby="b-downloads" class="mt-16 grid gap-10 lg:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.25fr)]">
        <div>
          <h2 id="b-downloads" class="font-star text-3xl uppercase tracking-[0.06em] text-secondary-300">One mark, two formats</h2>
          <p class="mt-4 max-w-md text-dark-50">Choose an individual file or get the exact same copies together.</p>
          <div class="mt-8 flex flex-wrap gap-3"><PrototypeAction label="SVG" detail="wts-logo-mark-2026.svg" /><PrototypeAction label="PNG" detail="wts-logo-mark-2026.png" /><PrototypeAction label="Download all" detail="wts-press-kit-2026.zip" primary /></div>
        </div>
        <LogoStage compact />
      </section>

      <section aria-labelledby="b-reference" class="mt-16 border-t border-white/15 pt-12">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div><h2 id="b-reference" class="font-star text-3xl uppercase tracking-[0.06em] text-primary-300">Reference</h2><p class="mt-3 text-dark-50">Copy without leaving the page.</p></div>
          <CopyButton value={`${description}\n\n${facts.map(([term, value]) => `${term}: ${value}`).join("\n")}`} label="Copy all facts" />
        </div>
        <dl class="mt-8 grid gap-px bg-white/15 sm:grid-cols-2 lg:grid-cols-3">
          <For each={facts}>{([term, value]) => <div class="bg-dark-900/95 p-5"><dt class="text-sm text-base-content/60">{term}</dt><dd class="mt-2 font-medium text-white">{value}</dd></div>}</For>
        </dl>
        <blockquote class="mt-px bg-dark-900/95 p-6 text-pretty text-lg leading-relaxed text-base-content/90">{description}</blockquote>
      </section>

      <section aria-labelledby="b-gradients" class="mt-16">
        <h2 id="b-gradients" class="font-star text-3xl uppercase tracking-[0.06em] text-secondary-300">Four logo gradients</h2>
        <div class="mt-8 grid gap-px bg-white/15 sm:grid-cols-2 lg:grid-cols-4"><For each={gradients}>{gradient => <div class="bg-dark-900/95 p-5"><GradientStrip gradient={gradient} vertical /></div>}</For></div>
      </section>

      <section id="b-guidance" aria-labelledby="b-guidance-title" class="mt-16 scroll-mt-8 border-y border-primary-500/45 py-12">
        <h2 id="b-guidance-title" class="font-star text-3xl uppercase tracking-[0.06em] text-primary-300">Shared boundaries</h2>
        <ol class="mt-8 grid gap-x-12 gap-y-6 md:grid-cols-2">
          <For each={usageRules}>{(rule, index) => <li class="flex gap-4"><span class="font-mono text-secondary-300">{index() + 1}</span><span class="leading-relaxed text-base-content/90">{rule}</span></li>}</For>
        </ol>
        <p class="mt-9 text-center">Not covered here? <a class="link font-bold text-primary-200" href="mailto:what@wts.sh">Ask what@wts.sh</a></p>
      </section>
    </article>
  );
}

function VariantC() {
  return (
    <article class="w-full max-w-7xl px-4 pb-28">
      <header class="border-b-2 border-primary-500 pb-8">
        <div class="flex flex-wrap items-end justify-between gap-8">
          <div>
            <p class="font-mono text-sm text-secondary-300">Public reference · 2026 edition</p>
            <h1 class="mt-3 text-balance font-star text-5xl font-bold uppercase tracking-[0.04em] text-primary-300 md:text-7xl">Press Kit</h1>
          </div>
          <PrototypeAction label="Download complete kit" detail="wts-press-kit-2026.zip" primary />
        </div>
      </header>

      <div class="grid gap-12 pt-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside class="lg:sticky lg:top-6 lg:self-start">
          <nav aria-label="Press Kit contents" class="border-y border-white/15 py-5">
            <p class="mb-3 font-bold text-white">On this page</p>
            <ol class="grid gap-1 text-sm">
              <li><a class="link block min-h-10 py-2 text-primary-200" href="#c-overview">Overview</a></li>
              <li><a class="link block min-h-10 py-2 text-primary-200" href="#c-downloads">Downloads</a></li>
              <li><a class="link block min-h-10 py-2 text-primary-200" href="#c-facts">Facts and copy</a></li>
              <li><a class="link block min-h-10 py-2 text-primary-200" href="#c-gradients">Gradients</a></li>
              <li><a class="link block min-h-10 py-2 text-primary-200" href="#c-guidance">Usage guidance</a></li>
            </ol>
          </nav>
          <p class="mt-5 text-sm leading-relaxed text-base-content/65">For Media and Partners. No advance approval is needed for the uses described here.</p>
        </aside>

        <div class="min-w-0">
          <section id="c-overview" aria-labelledby="c-overview-title" class="scroll-mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div>
              <h2 id="c-overview-title" class="text-balance text-4xl font-bold text-white">WhatTheStack 2026, ready to reference</h2>
              <p class="mt-5 max-w-3xl text-pretty text-xl leading-relaxed text-dark-50">{description}</p>
              <CopyButton value={description} label="Copy description" />
            </div>
            <div class="h-72 border border-white/15 bg-dark-900/95 p-8"><div class="mx-auto h-full w-40" aria-hidden="true"><img src={logoUrl} alt="" class="h-full w-full" /></div></div>
          </section>

          <section id="c-downloads" aria-labelledby="c-downloads-title" class="scroll-mt-8 mt-14 border-t border-white/15 pt-9">
            <div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"><div><h2 id="c-downloads-title" class="font-star text-3xl uppercase tracking-[0.06em] text-secondary-300">Downloads</h2><p class="mt-3 max-w-2xl text-dark-50">The archive contains the same SVG and PNG offered below, with no extra reference files.</p></div><PrototypeAction label="Download all · ZIP" detail="wts-press-kit-2026.zip" primary /></div>
            <div class="mt-7 divide-y divide-white/15 border-y border-white/15">
              <div class="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><strong class="text-lg text-white">wts-logo-mark-2026.svg</strong><p class="text-sm text-base-content/65">Original vector · transparent background</p></div><PrototypeAction label="Download SVG" detail="wts-logo-mark-2026.svg" /></div>
              <div class="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><strong class="text-lg text-white">wts-logo-mark-2026.png</strong><p class="text-sm text-base-content/65">1024 × 1301 · transparent background</p></div><PrototypeAction label="Download PNG" detail="wts-logo-mark-2026.png" /></div>
            </div>
          </section>

          <section id="c-facts" aria-labelledby="c-facts-title" class="scroll-mt-8 mt-14 border-t border-white/15 pt-9">
            <div class="flex flex-wrap items-end justify-between gap-4"><div><h2 id="c-facts-title" class="font-star text-3xl uppercase tracking-[0.06em] text-primary-300">Facts and copy</h2><p class="mt-3 text-dark-50">Stable public details for WhatTheStack 2026.</p></div><CopyButton value={facts.map(([term, value]) => `${term}: ${value}`).join("\n")} label="Copy all facts" /></div>
            <dl class="mt-7 divide-y divide-white/15 border-y border-white/15">
              <For each={facts}>{([term, value]) => <div class="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center"><dt class="text-sm text-base-content/60">{term}</dt><dd class="font-medium text-white">{value}</dd><CopyButton value={value} /></div>}</For>
            </dl>
          </section>

          <section id="c-gradients" aria-labelledby="c-gradients-title" class="scroll-mt-8 mt-14 border-t border-white/15 pt-9">
            <h2 id="c-gradients-title" class="font-star text-3xl uppercase tracking-[0.06em] text-secondary-300">Logo gradients</h2>
            <p class="mt-3 max-w-2xl text-dark-50">Use these exact gradient pairs as WhatTheStack 2026 promotional accents. They are not a complete brand palette.</p>
            <div class="mt-7 grid gap-7 sm:grid-cols-2"><For each={gradients}>{gradient => <GradientStrip gradient={gradient} />}</For></div>
          </section>

          <section id="c-guidance" aria-labelledby="c-guidance-title" class="scroll-mt-8 mt-14 border-t border-white/15 pt-9">
            <h2 id="c-guidance-title" class="font-star text-3xl uppercase tracking-[0.06em] text-primary-300">Usage guidance</h2>
            <div class="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <ul class="divide-y divide-white/15 border-y border-white/15"><For each={usageRules}>{rule => <li class="py-4 leading-relaxed text-base-content/90">{rule}</li>}</For></ul>
              <aside class="border border-primary-500/50 p-5"><strong class="text-white">Outside these uses?</strong><p class="mt-3 text-sm leading-relaxed text-dark-50">Check unsupported claims or uses with the team.</p><a class="link mt-5 block break-all font-bold text-primary-200" href="mailto:what@wts.sh">what@wts.sh</a></aside>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

const variants = [
  { key: "A", name: "Download first" },
  { key: "B", name: "Audience paths" },
  { key: "C", name: "Reference desk" },
] as const;

function PrototypeSwitcher(props: { current: string; onChange: (variant: string) => void }) {
  const currentIndex = () => Math.max(0, variants.findIndex(variant => variant.key === props.current));
  const cycle = (direction: -1 | 1) => {
    const next = (currentIndex() + direction + variants.length) % variants.length;
    props.onChange(variants[next].key);
  };

  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <Show when={import.meta.env.DEV}>
      <div class="fixed bottom-4 left-1/2 z-[300] flex -translate-x-1/2 items-center gap-2 rounded-full bg-white p-1.5 text-dark-950 shadow-lg shadow-black/50" aria-label="Prototype variant switcher">
        <button type="button" class="btn btn-circle btn-sm border-0 bg-dark-900 text-white hover:bg-primary-700" aria-label="Previous prototype variant" onClick={() => cycle(-1)}>←</button>
        <span class="min-w-40 px-3 text-center text-sm font-bold">{variants[currentIndex()].key} · {variants[currentIndex()].name}</span>
        <button type="button" class="btn btn-circle btn-sm border-0 bg-dark-900 text-white hover:bg-primary-700" aria-label="Next prototype variant" onClick={() => cycle(1)}>→</button>
      </div>
    </Show>
  );
}

export default function PressKitPrototype() {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = (): string => {
    const requestedVariant = searchParams.variant;
    return typeof requestedVariant === "string" && variants.some(variant => variant.key === requestedVariant)
      ? requestedVariant
      : "A";
  };
  const setVariant = (variant: string) => setSearchParams({ variant }, { replace: true });

  return (
    <Layout title="Press Kit structure prototype" description="Throwaway WhatTheStack 2026 Press Kit structure prototype">
      <Show when={current() === "A"}><VariantA /></Show>
      <Show when={current() === "B"}><VariantB /></Show>
      <Show when={current() === "C"}><VariantC /></Show>
      <PrototypeSwitcher current={current()} onChange={setVariant} />
    </Layout>
  );
}

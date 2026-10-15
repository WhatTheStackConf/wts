import { For, Show, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { formatPressKitGradient, type PressKitGradient } from "~/lib/press-kit";

export interface PressKitFact {
  label: string;
  value: string;
  href?: string;
}

export interface PressKitAsset {
  name: string;
  description?: string;
  href: string;
}

export interface PressKitGuidance {
  heading: string;
  body: string;
}

export interface PressKitRendererProps {
  name: string;
  description: string;
  logoSrc?: string;
  downloads?: readonly PressKitAsset[];
  facts?: readonly PressKitFact[];
  gradients?: readonly PressKitGradient[];
  guidance?: readonly PressKitGuidance[];
}

interface CopyButtonProps {
  value: string;
  label: string;
  ariaLabel?: string;
}

function CopyButton(props: CopyButtonProps) {
  const [copied, setCopied] = createSignal(false);
  let resetTimer: number | undefined;

  onCleanup(() => {
    if (resetTimer !== undefined) window.clearTimeout(resetTimer);
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
    } catch {
      return;
    }

    if (resetTimer !== undefined) window.clearTimeout(resetTimer);
    setCopied(true);
    resetTimer = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      class="btn btn-ghost btn-sm min-h-10 shrink-0"
      aria-label={props.ariaLabel}
      onClick={() => void copy()}
    >
      <span aria-live="polite" aria-atomic="true"><Show when={copied()} fallback={props.label}>Copied</Show></span>
    </button>
  );
}

export function PressKitRenderer(props: PressKitRendererProps): JSX.Element {
  return (
    <article class="w-full max-w-7xl px-4 pb-28">
      <header class="flex flex-wrap items-end justify-between gap-8 border-b-2 border-primary-500 pb-9">
        <div class="min-w-0">
          <h1 class="font-star text-5xl font-bold uppercase leading-tight tracking-[0.04em] text-primary-300 md:text-7xl">{props.name}</h1>
          <p class="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-base-content">{props.description}</p>
          <CopyButton value={props.description} label="Copy description" />
        </div>
        <Show when={props.logoSrc}>
          {(src) => <img class="max-h-48 w-auto max-w-40 object-contain" src={src()} alt={`${props.name} logo`} />}
        </Show>
      </header>

      <Show when={props.downloads?.length}>
        <section aria-labelledby="press-kit-downloads" class="mt-12 border-t border-base-content/20 pt-9">
          <h2 id="press-kit-downloads" class="font-star text-3xl uppercase tracking-[0.04em] text-secondary-300">Downloads</h2>
          <ul class="mt-7 divide-y divide-base-content/20 border-y border-base-content/20">
            <For each={props.downloads}>
              {(asset) => <li class="flex flex-wrap items-center justify-between gap-4 py-5">
                <div class="min-w-0">
                  <strong class="block break-all font-mono text-base">{asset.name}</strong>
                  <Show when={asset.description}><p class="mt-1 text-sm text-base-content/75">{asset.description}</p></Show>
                </div>
                <a class="btn btn-outline btn-primary min-h-11" href={asset.href} download={asset.name}>Download</a>
              </li>}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={props.facts?.length}>
        <section aria-labelledby="press-kit-facts" class="mt-12 border-t border-base-content/20 pt-9">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <h2 id="press-kit-facts" class="font-star text-3xl uppercase tracking-[0.04em] text-primary-300">Facts and copy</h2>
            <CopyButton value={props.facts?.map((fact) => `${fact.label}: ${fact.value}`).join("\n") || ""} label="Copy all facts" />
          </div>
          <ul class="mt-7 divide-y divide-base-content/20 border-y border-base-content/20">
            <For each={props.facts}>
              {(fact) => <li class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-4 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center">
                <span class="col-span-2 text-sm font-medium text-base-content/75 sm:col-span-1">{fact.label}</span>
                <span class="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                  <Show when={fact.href} fallback={fact.value}>{(href) => <a class="link" href={href()}>{fact.value}</a>}</Show>
                </span>
                <CopyButton value={fact.value} label="Copy" ariaLabel={`Copy ${fact.label}`} />
              </li>}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={props.gradients?.length}>
        <section aria-labelledby="press-kit-gradients" class="mt-12 border-t border-base-content/20 pt-9">
          <h2 id="press-kit-gradients" class="font-star text-3xl uppercase tracking-[0.04em] text-secondary-300">Logo gradients</h2>
          <div class="mt-7 grid gap-x-10 gap-y-7 sm:grid-cols-2">
            <For each={props.gradients}>
              {(gradient) => {
                const value = formatPressKitGradient(gradient);
                return <div class="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-center gap-4">
                  <div class="h-16 border border-base-content/20" style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }} aria-hidden="true" />
                  <div class="min-w-0"><p class="break-words font-mono text-sm font-bold [overflow-wrap:anywhere]">{value}</p><CopyButton value={value} label="Copy gradient" ariaLabel={`Copy gradient ${gradient.from} to ${gradient.to}`} /></div>
                </div>;
              }}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.guidance?.length}>
        <section aria-labelledby="press-kit-guidance" class="mt-12 border-t border-base-content/20 pt-9">
          <h2 id="press-kit-guidance" class="font-star text-3xl uppercase tracking-[0.04em] text-primary-300">Usage guidance</h2>
          <ul class="mt-7 divide-y divide-base-content/20 border-y border-base-content/20">
            <For each={props.guidance}>
              {(item) => <li class="py-5"><h3 class="text-lg font-bold">{item.heading}</h3><p class="mt-2 max-w-3xl text-pretty leading-relaxed text-base-content/75">{item.body}</p></li>}
            </For>
          </ul>
        </section>
      </Show>
    </article>
  );
}

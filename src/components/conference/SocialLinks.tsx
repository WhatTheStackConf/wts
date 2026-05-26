import { For, Show } from "solid-js";

interface SocialLinksProps {
  handles: string[];
  variant?: "inline" | "chips";
}

function displayHandle(handle: string) {
  return handle.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function SocialLinks(props: SocialLinksProps) {
  const variant = () => props.variant ?? "inline";

  return (
    <Show when={props.handles.length > 0}>
      <div class="flex flex-wrap gap-2 sm:gap-3">
        <For each={props.handles}>
          {(handle) => (
            <a
              href={handle.startsWith("http") ? handle : `https://${handle}`}
              target="_blank"
              rel="noopener noreferrer"
              class={
                variant() === "chips"
                  ? "min-h-11 inline-flex items-center px-3 py-2 text-sm font-mono text-accent-300 border border-accent-500/35 bg-dark-900/80 hover:border-primary-400/50 hover:text-primary-200 transition-colors duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] truncate max-w-full sm:max-w-xs"
                  : "min-h-11 inline-flex items-center text-sm font-mono text-primary-400 hover:text-primary-300 transition-colors truncate max-w-xs"
              }
            >
              {displayHandle(handle)}
            </a>
          )}
        </For>
      </div>
    </Show>
  );
}

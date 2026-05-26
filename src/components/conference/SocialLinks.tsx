import { For, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import {
  getSocialIcon,
  getSocialPlatformLabel,
  socialLinkHref,
} from "~/lib/social-links";

interface SocialLinksProps {
  handles: string[];
}

export function SocialLinks(props: SocialLinksProps) {
  return (
    <Show when={props.handles.length > 0}>
      <ul class="flex flex-wrap gap-2 list-none p-0 m-0" role="list">
        <For each={props.handles}>
          {(handle) => (
            <li>
              <a
                href={socialLinkHref(handle)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={getSocialPlatformLabel(handle)}
                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-primary-400 hover:text-primary-300 hover:bg-white/5 transition-colors"
              >
                <Icon icon={getSocialIcon(handle)} class="text-2xl" aria-hidden="true" />
              </a>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

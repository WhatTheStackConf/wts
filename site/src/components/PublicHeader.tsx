import { Show } from "solid-js";
import logoUrl from "~/assets/images/LogoSolo.svg";
import { Icon } from "~/components/Icon";
import { publicEditionName } from "~/lib/conference-guide-content";

interface PublicHeaderProps {
  landing?: boolean;
  brandRef?: (element: HTMLAnchorElement) => void;
  navRef?: (element: HTMLElement) => void;
}

export function PublicHeader(props: PublicHeaderProps) {
  const gatheringHref = props.landing ? "#about" : "/#about";
  const archiveHref = props.landing ? "#archive" : "/#archive";

  return (
    <header class="orbit-header public-header" data-header-state={props.landing ? undefined : "compact"}>
      <a
        ref={(element) => props.brandRef?.(element)}
        class="orbit-brand"
        href="/"
        aria-label={`${publicEditionName} home`}
      >
        <div class="orbit-brand-lockup">
          <img src={logoUrl} alt="" width="36" height="46" />
          <Show when={props.landing} fallback={<span class="orbit-brand-name">WhatTheStack</span>}>
            <h1 class="orbit-brand-name">WhatTheStack</h1>
          </Show>
        </div>
        <span class="orbit-brand-year">2027</span>
      </a>
      <nav
        ref={(element) => props.navRef?.(element)}
        class="orbit-nav"
        aria-label="Main navigation"
      >
        <a href={gatheringHref}>The conference</a>
        <a href={archiveHref}>Past editions</a>
        <a href="/user">Sign in / Profile</a>
        <button
          class="orbit-nav-cta"
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("wts:open-newsletter"))}
        >
          <span class="orbit-action-label">Get updates</span>
          <span class="orbit-action-arrow" aria-hidden="true"><Icon icon="ph:arrow-right-bold" /></span>
        </button>
      </nav>
    </header>
  );
}

import { Show, createSignal, onSettled } from "solid-js";
import { Portal } from "@solidjs/web";
import logoUrl from "~/assets/images/LogoSolo.svg";
import { Icon } from "~/components/Icon";
import { publicEditionName } from "~/lib/conference-guide-content";
import "~/styles/public-menu.css";

interface PublicHeaderProps {
  landing?: boolean;
  brandRef?: (element: HTMLAnchorElement) => void;
  navRef?: (element: HTMLElement) => void;
}

const MENU_ID = "orbit-menu";

function openNewsletter() {
  window.dispatchEvent(new CustomEvent("wts:open-newsletter"));
}

export function PublicHeader(props: PublicHeaderProps) {
  const gatheringHref = props.landing ? "#about" : "/#about";
  const archiveHref = props.landing ? "#archive" : "/#archive";
  const [menuOpen, setMenuOpen] = createSignal(false);
  let toggle: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;

  const closeMenu = (refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) toggle?.focus();
  };
  const openMenu = () => {
    setMenuOpen(true);
    requestAnimationFrame(() => panel?.querySelector<HTMLElement>("a, button")?.focus());
  };
  // The panel renders into the page shell, outside the landing cover clip, so the night sky still applies.
  const menuMount = () => toggle?.closest(".landing-2027, .supporting-shell") ?? document.body;

  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menuOpen()) return;
      event.preventDefault();
      closeMenu(true);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuOpen() && !panel?.contains(target) && !toggle?.contains(target)) closeMenu(false);
    };
    const onWide = (event: MediaQueryListEvent) => {
      if (event.matches) closeMenu(false);
    };
    const wide = window.matchMedia("(min-width: 768px)");
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      wide.removeEventListener("change", onWide);
    };
  });

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
        <button class="orbit-nav-cta" type="button" onClick={openNewsletter}>
          <span class="orbit-action-label">Get updates</span>
          <span class="orbit-action-arrow" aria-hidden="true"><Icon icon="ph:arrow-right-bold" /></span>
        </button>
      </nav>
      <button
        ref={(element) => { toggle = element; }}
        class="orbit-menu-toggle"
        type="button"
        aria-expanded={menuOpen() ? "true" : "false"}
        aria-controls={MENU_ID}
        onClick={() => (menuOpen() ? closeMenu(false) : openMenu())}
      >
        <span class="orbit-menu-toggle-label">Menu</span>
        <span class="orbit-menu-toggle-mark" aria-hidden="true" />
      </button>
      <Show when={menuOpen()}>
        <Portal mount={menuMount()}>
          <div ref={(element) => { panel = element; }} id={MENU_ID} class="orbit-menu">
            <nav class="orbit-menu-nav" aria-label="Main navigation">
              <a href={gatheringHref} onClick={() => closeMenu(false)}>The conference</a>
              <a href={archiveHref} onClick={() => closeMenu(false)}>Past editions</a>
              <a href="/user" onClick={() => closeMenu(false)}>Sign in / Profile</a>
              <button
                class="orbit-nav-cta"
                type="button"
                onClick={() => {
                  closeMenu(false);
                  openNewsletter();
                }}
              >
                <span class="orbit-action-label">Get updates</span>
                <span class="orbit-action-arrow" aria-hidden="true"><Icon icon="ph:arrow-right-bold" /></span>
              </button>
            </nav>
          </div>
        </Portal>
      </Show>
    </header>
  );
}

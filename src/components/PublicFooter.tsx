import { For } from "solid-js";
import logoUrl from "~/assets/images/LogoSolo.svg";
import { Icon } from "~/components/Icon";
import { publicEditionName } from "~/lib/conference-guide-content";
import { publicLegalLinks, publicSocialLinks } from "~/lib/public-footer-links";

export function PublicFooter() {
  return (
    <footer class="orbit-footer">
      <div class="orbit-footer-top">
        <a class="orbit-footer-brand" href="/" aria-label={`${publicEditionName} home`}>
          <img src={logoUrl} alt="" width="34" height="43" />
          <span>WhatTheStack<br /><strong>2027</strong></span>
        </a>
        <p>All things software.<br />All things code.</p>
        <nav class="orbit-footer-links" aria-label="Community">
          <a href="https://blog.wts.sh" target="_blank" rel="noopener noreferrer">
            Blog
            <span class="orbit-footer-arrow orbit-outbound-arrow" aria-hidden="true">
              <Icon icon="ph:arrow-right-bold" />
            </span>
          </a>
          <For each={publicSocialLinks}>
            {(link) => (
              <a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noopener noreferrer" : undefined}>
                {link.label}
                <span class={`orbit-footer-arrow${link.external ? " orbit-outbound-arrow" : ""}`} aria-hidden="true">
                  <Icon icon="ph:arrow-right-bold" />
                </span>
              </a>
            )}
          </For>
        </nav>
      </div>
      <div class="orbit-footer-bottom">
        <span>© 2026 WhatTheStack · CodePub LLC</span>
        <nav aria-label="Legal">
          <For each={publicLegalLinks}>
            {(link) => <a href={link.href}>{link.label}</a>}
          </For>
        </nav>
      </div>
    </footer>
  );
}

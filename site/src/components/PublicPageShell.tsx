import type { ParentProps } from "solid-js";
import { clientOnly, type JSX } from "@solidjs/web";
import { PublicHeader } from "~/components/PublicHeader";
import { PublicFooter } from "~/components/PublicFooter";
import { PublicPageMetadata } from "~/components/PublicPageMetadata";
import { publicEditionName } from "~/lib/conference-guide-content";

const NewsletterPopup = clientOnly(() => import("~/components/NewsletterPopup"));

interface PublicPageShellProps extends ParentProps {
  title: string;
  description: string;
  ogSubtitle?: string;
}

export function PublicPageShell(props: PublicPageShellProps) {

  return (
    <div class="supporting-shell">
      <a class="support-skip" href="#main-content">Skip to main content</a>
      <PublicPageMetadata
        title={props.title}
        titleSuffix={` | ${publicEditionName}`}
        description={props.description}
        ogSubtitle={props.ogSubtitle}
      />
      <div class="support-header"><PublicHeader /></div>
      <main id="main-content" class="support-main" tabindex="-1">{props.children}</main>
      <PublicFooter />
      <NewsletterPopup />
    </div>
  );
}

interface SupportBandProps extends ParentProps {
  altitude: 1 | 2;
  label: JSX.Element;
  variant?: "lost";
}

export function SupportBand(props: SupportBandProps) {
  return (
    <div class="support-band" data-altitude={props.altitude} data-variant={props.variant}>
      <div class="support-band-inner">
        <p class="support-band-label">
          <span>{props.label}</span>
          <span class="support-band-datum" aria-hidden="true">▽ ALT {props.altitude}</span>
        </p>
        {props.children}
      </div>
    </div>
  );
}

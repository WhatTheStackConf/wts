import type { ParentProps } from "solid-js";
import { clientOnly } from "@solidjs/web";
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
      <NewsletterPopup appearance="light" />
    </div>
  );
}

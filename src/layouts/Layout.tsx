import { clientOnly, type JSX } from "@solidjs/web";
import { Link } from "@solidjs/meta";
import { Navbar } from "~/components/Navbar";
import CodeBackground from "~/components/CodeBackground";
import { Footer } from "~/components/Footer";

import {
  conferenceDefaultDescription,
  conferenceDefaultOgSubtitle,
  conferenceName,
} from "~/lib/conference-guide-content";
import { CapabilityRouteBoundary } from "~/components/CapabilityRouteBoundary";
import { PublicPageMetadata } from "~/components/PublicPageMetadata";

const NewsletterPopup = clientOnly(
  () => import("~/components/NewsletterPopup"),
);

interface LayoutProps {
  children: JSX.Element;
  title?: string;
  description?: string;
  ogSubtitle?: string;
}

export const Layout = (props: LayoutProps) => {
  const title = () => props.title || conferenceName;
  const description = () =>
    props.description || conferenceDefaultDescription;
  const ogSubtitle = () => props.ogSubtitle || conferenceDefaultOgSubtitle;

  return (
    <>
      <a
        href="#main-content"
        class="sr-only fixed left-3 top-3 z-[20000] rounded bg-base-100 px-4 py-3 font-mono text-base-content focus:not-sr-only"
        onClick={() => window.setTimeout(() => document.querySelector<HTMLElement>("#main-content")?.focus(), 0)}
      >
        Skip to main content
      </a>
      <Navbar />
      <Link rel="icon" href="/favicon.svg" />
      <PublicPageMetadata
        title={title()}
        description={description()}
        ogSubtitle={ogSubtitle()}
      />
      <main id="main-content" tabindex="-1" class="font-sans relative w-full min-h-screen flex flex-col items-center overflow-x-hidden">
        <CodeBackground />
        <div class="absolute z-24 w-full min-h-screen h-full top-0 left-0 bg-black opacity-[76%]"></div>

        <div
          class="fixed inset-0 z-23 pointer-events-none opacity-70 bg-brand-dark/20
                            [background-image:radial-gradient(circle_at_20%_30%,var(--color-dark-800)_0%,transparent_50%),radial-gradient(circle_at_80%_70%,var(--color-primary-950)_0%,transparent_50%)]"
        />

        {/* Layer 3: Content */}
        <div class="relative z-225 w-full md:max-w-[80%] flex flex-col items-center justify-center flex-grow py-20">
          <CapabilityRouteBoundary>{props.children}</CapabilityRouteBoundary>
        </div>
        <div class="w-full relative z-225">
          <Footer />
        </div>
        <NewsletterPopup />
      </main>
    </>
  );
};

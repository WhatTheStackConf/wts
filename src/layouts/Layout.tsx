import { JSX } from "solid-js";
import { Title, Meta, Link } from "@solidjs/meta";
import { Navbar } from "~/components/Navbar";
import CodeBackground from "../components/CodeBackground";
import { Footer } from "~/components/Footer";
import { clientOnly } from "@solidjs/start";

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
  const title = () => props.title || "WhatTheStack 2026";
  const description = () =>
    props.description ||
    "All things software, all things code. September 19th, Skopje.";
  const ogSubtitle = () => props.ogSubtitle || "September 19th // Skopje, MK";

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
      <Title>{title()}</Title>
      <Link rel="icon" href="/favicon.svg" />
      <Meta name="description" content={description()} />
      <Meta property="og:title" content={title()} />
      <Meta property="og:description" content={description()} />
      <Meta property="og:image" content={`/api/og?title=${encodeURIComponent(title())}&subtitle=${encodeURIComponent(ogSubtitle())}`} />
      <Meta property="og:type" content="website" />
      <Meta name="twitter:card" content="summary_large_image" />
      <main id="main-content" tabindex="-1" class="font-sans relative w-full min-h-screen flex flex-col items-center overflow-x-hidden">
        <CodeBackground />
        <div class="absolute z-24 w-full min-h-screen h-full top-0 left-0 bg-black opacity-[76%]"></div>

        <div
          class="fixed inset-0 z-23 pointer-events-none opacity-70 bg-brand-dark/20
                            [background-image:radial-gradient(circle_at_20%_30%,var(--color-dark-800)_0%,transparent_50%),radial-gradient(circle_at_80%_70%,var(--color-primary-950)_0%,transparent_50%)]"
        />

        {/* Layer 3: Content */}
        <div class="relative z-225 w-full md:max-w-[80%] flex flex-col items-center justify-center flex-grow py-20">
          {props.children}
        </div>
        <div class="w-full relative z-225">
          <Footer />
        </div>
        <NewsletterPopup />
      </main>
    </>
  );
};

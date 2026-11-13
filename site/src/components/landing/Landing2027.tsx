import { clientOnly } from "@solidjs/web";
import { Link } from "@solidjs/meta";
import { For, createSignal, onSettled } from "solid-js";

import { Icon } from "~/components/Icon";
import { PublicHeader } from "~/components/PublicHeader";
import { PublicFooter } from "~/components/PublicFooter";
import LaunchScene, { type LaunchSceneMode } from "~/components/landing/LaunchScene";
import { bootHud } from "~/components/landing/hud-boot";
import "~/styles/landing-2027.css";
import "~/styles/landing-hud.css";
import { PublicPageMetadata } from "~/components/PublicPageMetadata";


import { publicEditionName } from "~/lib/conference-guide-content";
const pastEditions = [
  {
    year: "2026",
    href: "https://2026.wts.sh",
    ariaLabel: "Visit the 2026 WhatTheStack edition site",
    label: "Edition site",
    description: "The talks, speakers, and communities from 2026.",
  },
  {
    year: "2025",
    href: "https://2025.wts.sh",
    ariaLabel: "Visit the 2025 WhatTheStack edition archive",
    label: "Edition archive",
    description: "A look back at WTS 2025.",
  },
  {
    year: "2024",
    href: "https://2024.wts.sh",
    ariaLabel: "Visit the 2024 WhatTheStack edition archive",
    label: "Edition archive",
    description: "Where WhatTheStack started.",
  },
] as const;

/* HUD boot order on the archive sheet: label, heading, and intro come first (lines 0–2). */
const ARCHIVE_HEAD_LINES = 3;

const editionAxis = pastEditions.map((edition, index) => ({
  ...edition,
  mark: `ED. ${String(pastEditions.length - index).padStart(2, "0")}`,
  // The editions read upward, so ED. 01 (the last row) boots first.
  hudLine: String(ARCHIVE_HEAD_LINES + pastEditions.length - 1 - index),
}));

const NewsletterPopup = clientOnly(
  () => import("~/components/NewsletterPopup"),
);

const openNewsletter = () => {
  window.dispatchEvent(new CustomEvent("wts:open-newsletter"));
};


function orbitTravel(header: HTMLElement, brand: HTMLAnchorElement, mark: HTMLImageElement, nav: HTMLElement): [string, string][] {
  const brandStyle = window.getComputedStyle(brand);
  const headerRect = header.getBoundingClientRect();
  const brandWidth = brand.offsetWidth;
  const brandHeight = brand.offsetHeight;
  const brandTop = Number.parseFloat(brandStyle.top);
  const headerStyle = window.getComputedStyle(header);
  const headerPaddingLeft = Number.parseFloat(headerStyle.paddingLeft);
  const headerPaddingRight = Number.parseFloat(headerStyle.paddingRight);
  const compactLogoHeight = Number.parseFloat(brandStyle.getPropertyValue("--orbit-brand-compact-logo-height"));
  const expandedLogoHeight = mark.offsetHeight;
  const navWidth = nav.offsetWidth;
  const navHeight = nav.offsetHeight;
  const navStartLeft = window.innerWidth / 2 - navWidth / 2;
  const startLeft = window.innerWidth / 2 - brandWidth / 2;
  const startCenterY = headerRect.top + brandTop + brandHeight / 2;
  const isMobileHeader = window.matchMedia("(max-width: 767px)").matches;
  const targetLeft = headerRect.left + headerPaddingLeft;
  const targetCenterY = headerRect.top + (isMobileHeader ? header.offsetHeight / 4 : headerRect.height / 2);
  const compactNavLeft = isMobileHeader ? navStartLeft : headerRect.right - headerPaddingRight - navWidth;
  const availableWidth = Math.max(
    0,
    (isMobileHeader ? headerRect.width - headerPaddingLeft - headerPaddingRight : compactNavLeft - targetLeft - 12),
  );
  const scale = Math.min(compactLogoHeight / expandedLogoHeight, availableWidth / brandWidth);
  const shrinkOffset = (brandWidth * (1 - scale)) / 2;

  const navStartTop = Number.parseFloat(window.getComputedStyle(nav).top);
  const navCompactTop = isMobileHeader
    ? Number.parseFloat(headerStyle.getPropertyValue("--orbit-nav-compact-top"))
    : (header.offsetHeight - navHeight) / 2;
  return [
    ["--orbit-brand-travel-x", `${targetLeft - startLeft - shrinkOffset}px`],
    ["--orbit-brand-travel-y", `${targetCenterY - startCenterY}px`],
    ["--orbit-brand-contract-scale", `${scale}`],
    ["--orbit-nav-travel-x", `${compactNavLeft - navStartLeft}px`],
    ["--orbit-nav-travel-y", `${navCompactTop - navStartTop}px`],
  ];
}

export const Landing2027 = () => {
  let landingRoot: HTMLDivElement | undefined;
  let coverReservation: HTMLDivElement | undefined;
  let coverStage: HTMLDivElement | undefined;
  let heroCopy: HTMLDivElement | undefined;
  let orbitBrand: HTMLAnchorElement | undefined;
  let orbitNav: HTMLElement | undefined;
  const [night, setNight] = createSignal(false);
  const [launchMode, setLaunchMode] = createSignal<LaunchSceneMode>("static");

  onSettled(() => {
    if (!coverReservation || !coverStage || typeof window === "undefined") return;
    let disposed = false;

    const supportsScrollCover = window.CSS?.supports?.("(animation-timeline: scroll()) and (animation-range: 0% 100%)") ?? false;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

    const resizeCover = () => {
      if (disposed) return;
      coverStage!.removeAttribute("data-scroll-ready");
      if (!supportsScrollCover || motionPreference.matches || !orbitBrand || !orbitNav) return;

      const header = coverStage!.querySelector<HTMLElement>(".orbit-header");
      const mark = orbitBrand.querySelector<HTMLImageElement>("img");
      const brandYear = orbitBrand.querySelector<HTMLElement>(".orbit-brand-year");
      if (!header || !mark || !brandYear) return;
      const expandedHeight = coverStage!.getBoundingClientRect().height;
      coverReservation!.style.setProperty("--orbit-cover-expanded", `${expandedHeight}px`);
      coverStage!.setAttribute("data-scroll-ready", "true");

      for (const [property, value] of orbitTravel(header, orbitBrand, mark, orbitNav)) {
        coverReservation!.style.setProperty(property, value);
      }
    };
    resizeCover();
    void document.fonts.ready.then(resizeCover);
    const visibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === heroCopy && heroCopy) {
          heroCopy.inert = !(entry.isIntersecting && entry.intersectionRatio >= 0.025);
        }
      }
    }, { threshold: [0, 0.025] });
    if (heroCopy) visibilityObserver.observe(heroCopy);
    window.addEventListener("resize", resizeCover);
    motionPreference.addEventListener("change", resizeCover);

    return () => {
      window.removeEventListener("resize", resizeCover);
      disposed = true;
      visibilityObserver.disconnect();
      motionPreference.removeEventListener("change", resizeCover);
    };
  });

  onSettled(() => {
    const footer = landingRoot?.querySelector<HTMLElement>(".orbit-footer-band");
    if (!landingRoot || !footer || typeof ResizeObserver === "undefined") return;
    const root = landingRoot;
    const observer = new ResizeObserver(([entry]) => {
      root.style.setProperty("--orbit-footer-height", `${entry.borderBoxSize[0].blockSize}px`);
    });
    observer.observe(footer);
    return () => observer.disconnect();
  });

  onSettled(() => (landingRoot ? bootHud(landingRoot) : undefined));

  return (
    <div class="landing-2027" ref={(element) => { landingRoot = element; }} data-sky={night() ? "night" : "day"} data-launch={launchMode()}>
      <a class="orbit-skip" href="#main-content">Skip to main content</a>
      <LaunchScene onNightChange={setNight} onModeChange={setLaunchMode} />
      <Link rel="icon" href="/favicon.svg" />
      <PublicPageMetadata
        title={`${publicEditionName} — All things software. All things code.`}
        description="WhatTheStack 2027 is a tech conference for software professionals. The web, AI, infrastructure, and the decisions behind the software we build."
        ogTitle={publicEditionName}
        ogDescription="A tech conference for people who build software. Talks and workshops, with the hallway conversations in between."
        ogSubtitle="All things software. All things code."
        canonicalUrl="https://wts.sh/"
      />

      <div class="orbit-cover-reservation" ref={(element) => { coverReservation = element; }}>
        <div class="orbit-cover-stage" ref={(element) => { coverStage = element; }}>
          <PublicHeader
            landing
            brandRef={(element) => { orbitBrand = element; }}
            navRef={(element) => { orbitNav = element; }}
          />


          <section class="orbit-hero" aria-label={publicEditionName} data-launch-station="countdown">
            <div class="orbit-hero-copy" ref={(element) => { heroCopy = element; }}>
              <p class="orbit-lede">
                A tech conference for people who build software. Talks and
                workshops, with the hallway conversations in between.
              </p>

              <p class="orbit-pending">We're working on WTS 2027. Dates and details to follow.</p>
            </div>
            <div class="orbit-hero-foot" aria-hidden="true"><span>All things software. All things code.</span><span>WTS / 2027</span></div>
          </section>
        </div>
        <div class="orbit-header-glass" aria-hidden="true" />
      </div>
      <main id="main-content" class="orbit-main" tabindex="-1">

        <section class="orbit-about" aria-labelledby="about-title">
          <div class="orbit-section-heading" data-launch-station="liftoff">
            <div class="orbit-section-title" id="about" data-hud>
              <span class="orbit-section-mark" aria-hidden="true" data-hud-line="type">WTS—</span>
              <h2 id="about-title" data-hud-line="flicker" style={{ "--hud-i": "1" }}>What's happening in your stack?</h2>
            </div>
          </div>
          <div class="orbit-about-copy orbit-panel" data-launch-station="max-q" data-hud>
            <p data-hud-line>
              The web, AI, infrastructure, DevOps, and everything else that goes
              into building software. WTS brings software professionals together
              to share what they're working on and learn from people who've had
              to solve similar problems.
            </p>
            <p data-hud-line style={{ "--hud-i": "1" }}>
              We talk about how software works, but also why we build it the way
              we do and what people need from it. Product decisions belong in
              that conversation too. It usually carries on over coffee.
            </p>
            <button class="orbit-inline-link" type="button" onClick={openNewsletter} data-hud-line style={{ "--hud-i": "2" }}>
              <span class="orbit-inline-link-label">Get WTS 2027 updates</span>
              <span class="orbit-inline-arrow" aria-hidden="true"><Icon icon="ph:arrow-right-bold" /></span>
            </button>
          </div>
        </section>

        <section class="orbit-archive" id="archive" aria-labelledby="archive-title" data-launch-station="meco">
          <div class="orbit-archive-sheet orbit-panel" data-hud>
            <div class="orbit-archive-heading">
              <p class="orbit-archive-label" data-hud-line="type">Past editions</p>
              <h2 id="archive-title" data-hud-line="flicker" style={{ "--hud-i": "1" }}>We've met<br />before.</h2>
              <p data-hud-line style={{ "--hud-i": "2" }}>Have a look at the talks, speakers, and communities that made the first three editions.</p>
            </div>
            <div class="orbit-editions">
              <For each={editionAxis}>
                {(edition) => (
                  <a
                    class="orbit-edition"
                    href={edition.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={edition.ariaLabel}
                    data-hud-line
                    style={{ "--hud-i": edition.hudLine }}
                  >
                    <span class="orbit-edition-mark" aria-hidden="true">{edition.mark}</span>
                    <span class="orbit-edition-year">{edition.year}</span>
                    <span class="orbit-edition-content">
                      <strong>{edition.label}</strong>
                      <span>{edition.description}</span>
                    </span>
                    <span class="orbit-edition-arrow orbit-outbound-arrow" aria-hidden="true">
                      <Icon icon="ph:arrow-right-bold" />
                    </span>
                  </a>
                )}
              </For>
            </div>
          </div>
        </section>

        <section class="orbit-signup" aria-labelledby="signup-title" data-launch-station="second-burn">
          <div class="orbit-signup-panel orbit-panel" data-hud>
            <p class="orbit-signup-label" data-hud-line="type">WTS 2027 updates</p>
            <h2 id="signup-title" data-hud-line="flicker" style={{ "--hud-i": "1" }}>See you at<br />the next one.</h2>
            <div class="orbit-signup-cta" data-launch-station="orbit" data-hud-line style={{ "--hud-i": "2" }}>
              <p>We'll email you when there's news about dates, speakers, and tickets.</p>
              <button class="orbit-button" type="button" onClick={openNewsletter}>
                <span class="orbit-action-label">Get updates</span>
                <span class="orbit-action-arrow" aria-hidden="true"><Icon icon="ph:arrow-right-bold" /></span>
              </button>
            </div>
          </div>
        </section>
      </main>

      <div class="orbit-footer-band">
        <PublicFooter />
      </div>
      <NewsletterPopup />
    </div>
  );
};

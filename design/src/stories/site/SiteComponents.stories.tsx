import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AccountLoading, AccountSheet, AccountSignIn, AccountUnavailable } from "../../../../site/src/components/AccountSheet";
import NewsletterPopup from "../../../../site/src/components/NewsletterPopup";
import { PublicFooter } from "../../../../site/src/components/PublicFooter";
import { PublicHeader } from "../../../../site/src/components/PublicHeader";
import { SupportBand } from "../../../../site/src/components/PublicPageShell";
import { SkopjeSkyline } from "../../../../site/src/components/landing/SkopjeSkyline";
import { SiteSurface } from "../../surfaces";

const meta = { title: "Site/Components", parameters: { app: "site" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Light glass on supporting pages. Below 768px the links move into the Menu panel. */
export const Header: Story = {
  render: () => <div class="supporting-shell"><div class="support-header"><PublicHeader /></div><main class="support-main" id="main-content"><div style={{ height: "40vh" }} /></main></div>,
};

export const HeaderPhone: Story = {
  name: "Header, phone",
  render: Header.render,
  globals: { viewport: { value: "mobile2" } },
  parameters: { viewport: { options: { mobile2: { name: "Phone 390", styles: { width: "390px", height: "760px" } } } } },
};

export const HeaderNight: Story = {
  name: "Header, night sky",
  render: () => <div class="supporting-shell" data-sky="night" style={{ background: "var(--alt-7)" }}><div class="support-header"><PublicHeader /></div><div style={{ height: "40vh" }} /></div>,
};

export const Footer: Story = { render: () => <div class="supporting-shell"><PublicFooter /></div> };

/** Reading pages sit at ALT 1. The 404 keeps the ALT 2 horizon. */
export const BandAlt1: Story = {
  name: "Band, ALT 1",
  render: () => <SiteSurface><SupportBand altitude={1} label="WTS 2027 · Policy"><h1 class="support-band-title">Code of Conduct</h1></SupportBand></SiteSurface>,
};

export const BandLost: Story = {
  name: "Band, ALT 2 lost",
  render: () => <SiteSurface><SupportBand altitude={2} label="WTS 2027 · 404" variant="lost"><h1 class="support-band-title">This page isn't here.</h1><nav class="support-actions" aria-label="Not found navigation"><a href="/">Home</a><a href="/#archive">Past editions</a></nav></SupportBand></SiteSurface>,
};

export const Account: Story = {
  render: () => <SiteSurface><AccountSheet headingId="sb-account" title="Your WTS account"><AccountSignIn headingId="sb-account" /></AccountSheet></SiteSurface>,
};

export const AccountStates: Story = {
  name: "Account, loading and unavailable",
  render: () => <SiteSurface><AccountSheet headingId="sb-account-states" title="Your WTS account"><AccountLoading label="Loading your account" /><AccountUnavailable onRetry={() => undefined} /></AccountSheet></SiteSurface>,
};

/** The dialog opens through the same "wts:open-newsletter" event the page uses. */
export const Newsletter: Story = {
  render: () => <SiteSurface><div style={{ height: "60vh" }} /><NewsletterPopup /></SiteSurface>,
  play: async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    window.dispatchEvent(new CustomEvent("wts:open-newsletter"));
  },
};

/** Hairline elevation of four Skopje buildings plus the future city layer. Motion stops under reduced motion. */
export const Skyline: Story = {
  render: () => <div class="launch-scene" style={{ position: "relative", height: "420px", color: "var(--color-orbit-ink)", background: "var(--alt-0)", overflow: "hidden" }}><div style={{ position: "absolute", inset: "auto 0 0 0" }}><SkopjeSkyline /></div></div>,
};

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AccountProfile } from "../../../../site/src/components/AccountProfile";
import { AccountLoading, AccountSheet, AccountSignIn, AccountUnavailable } from "../../../../site/src/components/AccountSheet";
import NewsletterPopup from "../../../../site/src/components/NewsletterPopup";
import { PublicFooter } from "../../../../site/src/components/PublicFooter";
import { PublicHeader } from "../../../../site/src/components/PublicHeader";
import { SupportBand } from "../../../../site/src/components/PublicPageShell";
import { SkopjeSkyline } from "../../../../site/src/components/landing/SkopjeSkyline";
import { SiteSurface } from "../../surfaces";
// Route and scene CSS: the /user routes and LaunchScene import these themselves.
import "../../../../site/src/styles/account.css";
import "../../../../site/src/styles/launch-scene.css";

type Account = Parameters<typeof AccountProfile>[0]["account"];
const SAMPLE_ACCOUNT: Account = {
  wtsUserId: "sample-user-01",
  editionId: "2027",
  isAdmin: false,
  accountUrl: "https://auth.wts.sh/account",
  profile: { version: 1, wtsUserId: "sample-user-01", name: "Ana Petrova", avatarUrl: null, preferredLanguage: "en", username: "ana", emailVisibility: false, revision: 1 },
};

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

export const HeaderPhoneMenu: Story = {
  name: "Header, phone menu open",
  render: Header.render,
  globals: HeaderPhone.globals,
  parameters: HeaderPhone.parameters,
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    canvasElement.querySelector<HTMLButtonElement>(".orbit-menu-toggle")?.click();
  },
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

/** /user signed in. Every account page is one ALT 0 sheet with a datum row and one hairline panel. */
export const Account: Story = {
  render: () => <SiteSurface><AccountSheet headingId="sb-account" title="Your account"><p>Signed in as Ana Petrova.</p><div class="account-actions"><a class="btn btn-primary" href="#">View your profile</a></div></AccountSheet></SiteSurface>,
};

export const AccountProfilePage: Story = {
  name: "Account, profile",
  render: () => <SiteSurface><AccountProfile account={SAMPLE_ACCOUNT} /></SiteSurface>,
};

export const AccountSignedOut: Story = {
  name: "Account, signed out",
  render: () => <SiteSurface><AccountSignIn headingId="sb-sign-in" /></SiteSurface>,
};

export const AccountLoadingState: Story = {
  name: "Account, loading",
  render: () => <SiteSurface><AccountLoading label="Loading your account..." /></SiteSurface>,
};

export const AccountUnavailableState: Story = {
  name: "Account, unavailable",
  render: () => <SiteSurface><AccountUnavailable onRetry={() => undefined} /></SiteSurface>,
};

/** The dialog opens through the same "wts:open-newsletter" event the page uses. */
export const Newsletter: Story = {
  render: () => <div class="supporting-shell"><main class="support-main" id="main-content"><div style={{ height: "60vh" }} /></main><NewsletterPopup /></div>,
  play: async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    window.dispatchEvent(new CustomEvent("wts:open-newsletter"));
  },
};

/** The static countdown frame of the landing: sky, clouds, the Skopje skyline and the ground datum.
 * The landing paints WebGL over this frame. Motion stops under reduced motion. */
export const Skyline: Story = {
  name: "Launch countdown, static",
  render: () => <div class="launch-scene" data-mode="static" style={{ position: "relative", height: "100vh" }}>
    <div class="launch-scene__frame">
      <div class="launch-scene__sky" />
      <div class="launch-scene__clouds"><span class="launch-scene__cloud launch-scene__cloud--cirrus" /><span class="launch-scene__cloud launch-scene__cloud--far" /><span class="launch-scene__cloud launch-scene__cloud--near" /></div>
      <div class="launch-scene__ground">
        <span class="launch-scene__cloud launch-scene__cloud--bank" />
        <SkopjeSkyline class="launch-scene__skyline" />
        <span class="launch-scene__ground-line" />
        <span class="launch-scene__datum">Skopje ▽ +240 m</span>
      </div>
    </div>
  </div>,
};

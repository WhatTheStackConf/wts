import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SiteSurface, Specimen } from "../../surfaces";

// The site copy of the flight kit: site/src/styles/public-links.css on real site class names.
const meta = { title: "Site/Controls", parameters: { app: "site" } } satisfies Meta;
export default meta;

export const Controls: StoryObj<typeof meta> = {
  render: () => <SiteSurface><div class="sb-page">
    <h1>Site controls</h1>
    <p>Primary buttons use the dark accent on paper. Secondary actions use a notched hairline frame. Links keep a dotted rule at rest.</p>
    <Specimen label="Primary" note=".btn.btn-primary"><button class="btn btn-primary" type="button">Get updates</button><button class="btn btn-primary" type="button" disabled>Subscribing…</button></Specimen>
    <Specimen label="Secondary" note=".btn.btn-outline, accent frame"><button class="btn btn-outline" type="button">Sign out of this site</button></Specimen>
    <Specimen label="Support actions" note=".support-actions links"><nav class="support-actions" aria-label="Example actions" style={{ margin: "0" }}><a href="#">Home</a><a href="#">Past editions</a></nav></Specimen>
    <Specimen label="Copy link" note=".support-prose a"><div class="support-prose" style={{ width: "auto", margin: "0", padding: "0" }}><div class="prose" style={{ display: "block" }}><p style={{ margin: "0" }}>Read the <a href="#">code of conduct</a> before you apply.</p></div></div></Specimen>
  </div></SiteSurface>,
};

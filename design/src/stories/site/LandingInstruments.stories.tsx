import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, onSettled } from "solid-js";
import { HudText } from "../../../../site/src/components/landing/HudText";
import { LaunchBoard } from "../../../../site/src/components/landing/LaunchBoard";
import { TMinus } from "../../../../site/src/components/landing/TMinus";
import { decryptBlock } from "../../../../site/src/components/landing/hud-decrypt";
import { SiteSurface, Specimen } from "../../surfaces";
// The landing imports these itself.
import "../../../../site/src/styles/landing-2027.css";
import "../../../../site/src/styles/landing-hud.css";
import "../../../../site/src/styles/landing-instruments.css";

const meta = { title: "Site/Landing instruments", parameters: { app: "site" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** A date 214 days from today, so the sample counter always has a value. The real page reads content/conference-guide.json. */
function sampleDate(): string {
  const date = new Date(Date.now() + 214 * 86_400_000);
  return date.toISOString().slice(0, 10);
}

export const DecryptedHeading: Story = {
  name: "Decrypted heading",
  render: () => {
    let block!: HTMLDivElement;
    const replay = () => {
      decryptBlock(block, false);
      delete block.dataset.hudState;
      requestAnimationFrame(() => {
        block.dataset.hudState = "on";
        decryptBlock(block, true);
      });
    };
    onSettled(replay);
    return <SiteSurface><div class="sb-page">
      <h1>Decrypted heading</h1>
      <p>During the HUD boot a section title resolves from glyphs over one beat. Screen readers get the real text. Reduced motion shows the text at once.</p>
      <div class="landing-2027" data-hud-boot="ready" style={{ background: "none" }}>
        <div class="orbit-about" style={{ padding: "0", background: "none", "min-height": "0" }}>
          <div ref={block} data-hud>
            <h2 data-hud-line="decrypt" style={{ "--hud-i": "0" }}><HudText lines={["What's in your stack now?"]} /></h2>
          </div>
        </div>
      </div>
      <p style={{ "margin-top": "1.5rem" }}><button class="btn btn-outline" type="button" onClick={replay}>Play again</button></p>
    </div></SiteSurface>;
  },
};

export const LaunchBoardStory: Story = {
  name: "Launch board",
  render: () => {
    const [key, setKey] = createSignal(0);
    return <SiteSurface><div class="sb-page">
      <h1>Launch board</h1>
      <p>A split-flap readout of confirmed facts only. It flaps once on load, in under 1.5 seconds. Add the date and the venue when they are announced.</p>
      <Specimen label="Hero readout" note="LaunchBoard in .orbit-readout">
        <div class="orbit-readout" style={{ margin: "0" }}>{key() >= 0 ? <LaunchBoard words={["2027", "Skopje"]} label="WTS 2027, Skopje" /> : null}</div>
      </Specimen>
      <p><button class="btn btn-outline" type="button" onClick={() => setKey(key() + 1)}>Play again</button></p>
    </div></SiteSurface>;
  },
};

export const TMinusStory: Story = {
  name: "T-minus counter",
  render: () => <SiteSurface><div class="sb-page">
    <h1>T-minus counter</h1>
    <p>Days to the conference in the conference time zone. The landing shows it only after content/conference-guide.json announces the date. This sample uses a date 214 days from today.</p>
    <Specimen label="Hero readout" note="TMinus next to the launch board">
      <div class="orbit-readout" style={{ margin: "0" }}>
        <LaunchBoard words={["2027", "Skopje"]} label="WTS 2027, Skopje" />
        <TMinus localDate={sampleDate()} timeZone="Europe/Skopje" label="WhatTheStack 2027" />
      </div>
    </Specimen>
  </div></SiteSurface>,
};

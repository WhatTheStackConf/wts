import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { ErrorNotice, PresentationSummary, Section, SettingsSummary, SpeakerSummary } from "../../../../cfp/src/components/ApplicantUI";
import { AdminError, AdminSection, AdminStatus } from "../../../../cfp/src/components/admin/AdminUI";
import { PageBand } from "../../../../cfp/src/components/PageBand";
import { RichEditor } from "../../../../cfp/src/components/RichEditor";
import { CfpSurface, SbPage } from "../../surfaces";

// Sample data only. The names and the talk are invented for the stories.
const speaker = { fullName: "Ana Petrova", affiliation: "Example Labs", bio: "Builds product teams and the tools they ship with.", socialHandles: ["https://example.com/ana"], previousTalks: "" };
const settings = { preferredContactMethod: "Email", companyCoverExpenses: "Yes" as const };
const talk = { title: "Shipping LLM features without the slop", abstract: "<p>What we check before an LLM feature ships, and what we check after.</p>", keyTakeaways: "<ul><li>Evaluate on real traffic</li><li>Keep a human in the loop</li></ul>", technicalRequirements: "Projector, HDMI", previousPresentation: "", organizerNotes: "", additionalInfo: "" };

const meta = { title: "CFP/Components", parameters: { app: "cfp" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Applicant pages open with the ALT 3 band and still streaks. */
export const BandTall: Story = { name: "Page band, tall", render: () => <CfpSurface><PageBand title="Call for Papers" lede="Submit a talk proposal." /></CfpSurface> };
export const BandShort: Story = { name: "Page band, short", render: () => <CfpSurface><PageBand size="short" title="Edit your proposal" /></CfpSurface> };

export const ProposalSummary: Story = {
  name: "Proposal summary",
  render: () => <CfpSurface><SbPage title="Proposal summary" note="The Review step and the proposal page show the saved answers in these sections."><div class="cfp-stack">
    <Section title="About you" editHref="/profile" editLabel="Edit your details"><SpeakerSummary speaker={speaker} email="ana@example.com" /><SettingsSummary settings={settings} /></Section>
    <Section title="Talk" editHref="#" editLabel="Edit talk"><PresentationSummary presentation={talk} /></Section>
  </div></SbPage></CfpSurface>,
};

export const Errors: Story = {
  render: () => <CfpSurface><SbPage title="Errors" note="A save error lists each field issue. A staff error names what happened and offers one way out."><div class="cfp-stack">
    <ErrorNotice message="We could not save your draft." issues={[{ field: "Title", message: "Add a title." }]} onRetry={() => undefined} retryLabel="Try again" />
    <AdminError state="stale" onRetry={() => undefined} />
  </div></SbPage></CfpSurface>,
};

/** Status is never color alone: each chip carries a square mark and a word. */
export const StatusChips: Story = {
  name: "Status chips",
  render: () => <CfpSurface staff><SbPage title="Status chips" note="The square marks the state. The word names it."><AdminSection title="Proposal status" description="Chips used on the admin list and the proposal page."><div style={{ display: "flex", gap: "0.75rem", "flex-wrap": "wrap" }}>
    <AdminStatus state="pending" label="Pending" /><AdminStatus state="accepted" label="Accepted" /><AdminStatus state="rejected" label="Rejected" /><AdminStatus state="closed" label="Closed" /><AdminStatus state="neutral" label="Not reviewed" />
  </div></AdminSection></SbPage></CfpSurface>,
};

export const Editor: Story = {
  name: "Rich text editor",
  render: () => {
    const [value, setValue] = createSignal("<p>What we check before an LLM feature ships.</p>");
    return <CfpSurface><SbPage title="Rich text editor" note="Bold, italic and lists only. The toolbar buttons show their pressed state."><div class="field" style={{ "max-width": "46rem" }}>
      <label>Abstract <span class="required">Required</span></label>
      <p class="hint" id="sb-abstract-help">Use the formatting controls to make your abstract easy to scan.</p>
      <RichEditor label="Abstract" name="abstract" value={value()} onInput={setValue} required descriptionId="sb-abstract-help" />
    </div></SbPage></CfpSurface>;
  },
};

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CfpSurface, Specimen } from "../../surfaces";

// The CFP copy of the flight kit: cfp/src/styles/app.css on real CFP class names.
const meta = { title: "CFP/Controls", parameters: { app: "cfp" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  render: () => <CfpSurface><div class="sb-page">
    <h1>Buttons</h1>
    <p>One primary action per screen. Danger plates only for destructive staff actions.</p>
    <Specimen label="Primary" note=".button"><button class="button" type="button">Submit proposal</button><button class="button" type="button" disabled>Saving profile…</button></Specimen>
    <Specimen label="Secondary" note=".button.button-secondary"><button class="button button-secondary" type="button">Back to your proposals</button></Specimen>
    <Specimen label="Danger" note=".button.button-danger"><button class="button button-danger" type="button">Revoke reviewer</button></Specimen>
    <Specimen label="Text button" note=".link-button"><button class="link-button" type="button">Edit talk</button></Specimen>
  </div></CfpSurface>,
};

export const Fields: Story = {
  render: () => <CfpSurface><div class="sb-page">
    <h1>Fields</h1>
    <p>A label that names a value is uppercase and tracked. A label that asks a question is sentence case.</p>
    <div class="cfp-stack" style={{ "max-width": "46rem" }}>
      <div class="field"><label for="sb-name">Full name <span class="required">Required</span></label><input id="sb-name" class="control" autocomplete="name" value="Ana Petrova" /></div>
      <div class="field"><label for="sb-email">Account email</label><input id="sb-email" class="control" type="email" value="ana@example.com" disabled /><span class="hint">Email comes from your verified WTS account.</span></div>
      <div class="field"><label for="sb-bio">Short bio <span class="required">Required</span></label><p class="hint" id="sb-bio-help">This bio can appear publicly if your talk is accepted.</p><textarea id="sb-bio" class="control" aria-describedby="sb-bio-help" /></div>
      <fieldset class="field choice-fieldset"><legend class="label-question">Can your company cover travel or accommodation?</legend>
        <div class="choice-grid" role="radiogroup"><label class="choice"><input type="radio" name="sb-cover" checked /><span>Yes</span></label><label class="choice"><input type="radio" name="sb-cover" /><span>No</span></label><label class="choice"><input type="radio" name="sb-cover" /><span>Other</span></label></div>
      </fieldset>
      <div class="field"><label for="sb-sort">Sort</label><select id="sb-sort" class="control"><option>Score</option><option>Submitted</option></select></div>
    </div>
  </div></CfpSurface>,
};

export const Notices: Story = {
  render: () => <CfpSurface><div class="sb-page">
    <h1>Notices</h1>
    <p>Notices are quiet. Mail appears only as a failure alert.</p>
    <div class="cfp-stack" style={{ "max-width": "46rem" }}>
      <p class="alert" role="status">Queued 3 decision emails.</p>
      <div class="alert" role="status"><p>Mail is not configured. <a class="inline-link" href="#">Check mail</a></p></div>
    </div>
  </div></CfpSurface>,
};

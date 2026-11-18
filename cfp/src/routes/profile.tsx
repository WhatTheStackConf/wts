import { createSignal, For, onSettled, Show } from "solid-js";
import { getWorkspace, saveApplicant } from "~/lib/cfp-actions";
import type { FieldIssue, Workspace } from "~/lib/cfp-model";
import { PageBand } from "~/components/PageBand";
import { ErrorNotice } from "~/components/ApplicantUI";

type PageError = { code: string; message: string; issues: FieldIssue[] };
type Expense = "Yes" | "No" | "Other" | "";
const expenseOptions = ["Yes", "No", "Other"] as const;
const blocksPage = (error: PageError | undefined) => error?.code === "unauthenticated" || error?.code === "unavailable";

export default function Profile() {
  const [workspace, setWorkspace] = createSignal<Workspace>();
  const [name, setName] = createSignal("");
  const [affiliation, setAffiliation] = createSignal("");
  const [bio, setBio] = createSignal("");
  const [socialHandles, setSocialHandles] = createSignal("");
  const [previousTalks, setPreviousTalks] = createSignal("");
  const [contact, setContact] = createSignal("");
  const [expenses, setExpenses] = createSignal<Expense>("");
  const [error, setError] = createSignal<PageError>();
  const [saved, setSaved] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(true);

  const fill = (next: Workspace) => {
    setWorkspace(next);
    setName(next.speaker.value.fullName);
    setAffiliation(next.speaker.value.affiliation);
    setBio(next.speaker.value.bio);
    setSocialHandles(next.speaker.value.socialHandles.join("\n"));
    setPreviousTalks(next.speaker.value.previousTalks);
    setContact(next.settings.value.preferredContactMethod);
    setExpenses(next.settings.value.companyCoverExpenses ?? "");
  };
  const load = async () => {
    setLoading(true);
    try {
      const result = await getWorkspace();
      if (result.ok) {
        fill(result.value);
        setError(undefined);
      } else setError({ code: result.error.code, message: result.error.message, issues: result.error.issues });
    } catch {
      setError({ code: "unavailable", message: "Your profile could not load. Try again later.", issues: [] });
    }
    setLoading(false);
  };
  onSettled(() => { void load().catch(() => { setError({ code: "unavailable", message: "Your profile could not load. Try again later.", issues: [] }); setLoading(false); }); });
  const reload = () => {
    if (workspace() && !window.confirm("Discard the changes on this page and load the latest saved profile?")) return;
    void load();
  };
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    const current = workspace();
    if (!current || busy()) return;
    setBusy(true);
    setSaved(false);
    try {
      const result = await saveApplicant({
        speaker: { expectedRevision: current.speaker.revision, changes: { fullName: name().trim(), affiliation: affiliation().trim(), bio: bio().trim(), socialHandles: socialHandles().split("\n").map((link) => link.trim()).filter(Boolean), previousTalks: previousTalks().trim() } },
        settings: { expectedRevision: current.settings.revision, changes: { preferredContactMethod: contact().trim(), companyCoverExpenses: expenses() || null } },
      });
      if (result.ok) {
        setWorkspace({ ...current, speaker: result.value.speaker, settings: result.value.settings });
        setSaved(true);
        setError(undefined);
      } else setError({ code: result.error.code, message: result.error.message, issues: result.error.issues });
    } catch {
      setError({ code: "unavailable", message: "The profile save failed. Your values remain on this page. Try again.", issues: [] });
    }
    setBusy(false);
  };

  return <>
    <PageBand size="short" title="Speaker profile" lede="We reuse these details for all your proposals. Changes here do not change a proposal you already submitted." />
    <Show when={loading()}><div class="cfp-loading" role="status">Loading your profile…</div></Show>
    <Show when={error()}>{(current) => <><ErrorNotice message={current().message} issues={current().issues} onRetry={current().code !== "unauthenticated" ? reload : undefined} retryLabel="Reload saved profile" /><Show when={current().code === "unauthenticated"}><a href={`/auth/login?returnTo=${encodeURIComponent("/profile")}`} rel="external">Sign in to edit your profile</a></Show></>}</Show>
    <Show when={workspace() && !blocksPage(error())}>
      <form class="surface form" onSubmit={save}>
        <div class="field"><label for="profile-email">Account email</label><input id="profile-email" class="control" type="email" value={workspace()!.email} disabled autocomplete="email" /><span class="hint">Email comes from your verified WTS account.</span></div>
        <fieldset class="form-section">
          <legend>Speaker details</legend>
        <div class="field"><label for="profile-name">Full name <span class="required">Required</span></label><input id="profile-name" class="control" name="fullName" autocomplete="name" maxlength="200" required value={name()} onInput={(event) => setName(event.currentTarget.value)} /></div>
        <div class="field"><label for="profile-affiliation">Affiliation</label><input id="profile-affiliation" class="control" name="affiliation" autocomplete="organization-title" maxlength="500" value={affiliation()} onInput={(event) => setAffiliation(event.currentTarget.value)} /></div>
        <div class="field"><label for="profile-bio">Short bio <span class="required">Required</span></label><p class="hint" id="profile-bio-help">This bio can appear publicly if your talk is accepted.</p><textarea id="profile-bio" class="control" name="bio" required maxlength="50000" aria-describedby="profile-bio-help" value={bio()} onInput={(event) => setBio(event.currentTarget.value)} /></div>
        </fieldset>
        <fieldset class="form-section">
          <legend>Links and experience</legend>
        <div class="field"><label for="profile-social">Social links</label><p class="hint" id="profile-social-help">Enter one link per line.</p><textarea id="profile-social" class="control" name="socialHandles" maxlength="15000" aria-describedby="profile-social-help" value={socialHandles()} onInput={(event) => setSocialHandles(event.currentTarget.value)} /></div>
        <div class="field"><label for="profile-talks">Previous talks</label><p class="hint" id="profile-talks-help">Add links to talks you gave before. We reuse this for each proposal.</p><textarea id="profile-talks" class="control" name="previousTalks" maxlength="50000" aria-describedby="profile-talks-help" value={previousTalks()} onInput={(event) => setPreviousTalks(event.currentTarget.value)} /></div>
        </fieldset>
        <fieldset class="form-section">
          <legend>Contact and travel</legend>
        <div class="field"><label for="contact-method">Preferred contact method</label><p class="hint" id="contact-method-help">How the organizers should reach you, for example email or phone.</p><input id="contact-method" class="control" name="preferredContactMethod" maxlength="500" aria-describedby="contact-method-help" autocomplete="off" value={contact()} onInput={(event) => setContact(event.currentTarget.value)} /></div>
        <fieldset class="field choice-fieldset">
          <legend class="label-question">Can your company cover travel or accommodation?</legend>
          <p class="hint" id="company-cover-help">You can leave this blank until you know. We ask again when you submit a proposal.</p>
          <div class="choice-grid" role="radiogroup" aria-describedby="company-cover-help">
            <label class="choice"><input type="radio" name="companyCoverExpenses" value="" checked={expenses() === ""} onChange={() => setExpenses("")} /><span>Not specified</span></label>
            <For each={expenseOptions}>{(option) => <label class="choice"><input type="radio" name="companyCoverExpenses" value={option} checked={expenses() === option} onChange={() => setExpenses(option)} /><span>{option}</span></label>}</For>
          </div>
        </fieldset>
        </fieldset>
        <div class="form-actions"><a class="button button-secondary" href="/applications">Back to your proposals</a><button class="button" type="submit" disabled={busy()}>{busy() ? "Saving profile…" : "Save profile"}</button></div>
        <Show when={saved()}><p role="status" class="muted">Your speaker profile is saved.</p></Show>
      </form>
    </Show>
  </>;
}

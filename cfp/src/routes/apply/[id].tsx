import { createSignal, For, Match, onSettled, Show, Switch } from "solid-js";
import { useBeforeLeave, useNavigate, useParams } from "@solidjs/router";
import { getDraft, saveDraft, submitDraft } from "~/lib/cfp-actions";
import type { ActionResult } from "~/lib/account-model";
import type { DraftView, Presentation, SubmissionReceipt } from "~/lib/cfp-model";
import { ErrorNotice, PresentationSummary, SettingsSummary, SpeakerSummary } from "~/components/ApplicantUI";
import { PageBand } from "~/components/PageBand";
import { RichEditor } from "~/components/RichEditor";

const steps = ["About you", "Talk", "Experience and travel", "Review"] as const;
type Step = 1 | 2 | 3 | 4;
const expenseOptions = ["Yes", "No", "Other"] as const;
type DraftError = { code: string; message: string; issues: { field: string; message: string }[] };
type ApplicantChanges = { speaker?: { expectedRevision: number; changes: { fullName: string; affiliation: string; bio: string; socialHandles: string[]; previousTalks: string } }; settings?: { expectedRevision: number; changes: { preferredContactMethod: string; companyCoverExpenses?: "Yes" | "No" | "Other" | null } } };
type DraftChanges = { applicant?: ApplicantChanges; fields?: Partial<Presentation> };

const blocksPage = (error: DraftError | undefined) => error?.code === "unauthenticated" || error?.code === "unavailable";
const RELOADABLE_ERRORS = new Set(["conflict", "unavailable"]);

function draftSaveInput(current: DraftView, { applicant, fields }: DraftChanges) {
  return { draftId: current.draft.id, expectedDraftRevision: current.draft.revision, ...(fields ? { presentation: fields } : {}), ...(applicant ? { applicant } : {}) };
}

interface DraftFormActionsProps {
  busy: boolean;
  locked: boolean;
  next: string;
  nextWhileSaving?: string;
  onBack: () => void;
  onSave: () => void;
}

function DraftFormActions(props: DraftFormActionsProps) {
  return <div class="form-actions"><button type="button" class="button button-secondary" onClick={props.onBack}>Back</button><button type="button" class="button button-secondary" disabled={props.locked} onClick={props.onSave}>{props.busy ? "Saving…" : "Save draft"}</button><button type="submit" class="button" disabled={props.locked}>{props.busy ? props.nextWhileSaving ?? props.next : props.next}</button></div>;
}

export default function Apply() {
  const params = useParams();
  const navigate = useNavigate();
  const [view, setView] = createSignal<DraftView>();
  const [presentation, setPresentation] = createSignal<Presentation>({ title: "", abstract: "", keyTakeaways: "", technicalRequirements: "", previousPresentation: "", organizerNotes: "", additionalInfo: "" });
  const [name, setName] = createSignal("");
  const [affiliation, setAffiliation] = createSignal("");
  const [bio, setBio] = createSignal("");
  const [socialHandles, setSocialHandles] = createSignal("");
  const [previousTalks, setPreviousTalks] = createSignal("");
  const [contact, setContact] = createSignal("");
  const [expense, setExpense] = createSignal<"Yes" | "No" | "Other" | "">("");
  const [step, setStep] = createSignal<Step>(1);
  const [error, setError] = createSignal<DraftError>();
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [receipt, setReceipt] = createSignal<SubmissionReceipt | undefined>(undefined);
  const savedPresentation = () => {
    const state = view()?.draft.state;
    return state?.kind === "active" ? state.presentation : undefined;
  };
  const editTargetId = () => {
    const purpose = view()?.draft.purpose;
    return purpose?.kind === "edit" ? purpose.targetId : undefined;
  };

  const fillApplicantForm = (next: DraftView) => {
    setName(next.speaker.value.fullName);
    setAffiliation(next.speaker.value.affiliation);
    setBio(next.speaker.value.bio);
    setSocialHandles(next.speaker.value.socialHandles.join("\n"));
    setPreviousTalks(next.speaker.value.previousTalks);
    setContact(next.settings.value.preferredContactMethod);
    setExpense(next.settings.value.companyCoverExpenses ?? "");
  };

  const load = async () => {
    setLoading(true);
    try {
      const result = await getDraft(params.id ?? "");
      if (!result.ok) {
        setError({ code: result.error.code, message: result.error.message, issues: result.error.issues });
        setLoading(false);
        return;
      }
      const next = result.value;
      setView(next);
      setError(undefined);
      fillApplicantForm(next);
      if (next.draft.state.kind === "active") setPresentation(next.draft.state.presentation);
      const profileComplete = Boolean(next.speaker.value.fullName.trim() && next.speaker.value.bio.trim());
      if (next.draft.state.kind === "committed") setReceipt(next.draft.state.receipt);
      setStep(profileComplete ? 2 : 1);
      setDirty(false);
      setSaved(false);
    } catch {
      setError({ code: "unavailable", message: "The saved draft could not load. Try again later.", issues: [] });
    }
    setLoading(false);
  };

  onSettled(() => { void load().catch(() => { setError({ code: "unavailable", message: "The saved draft could not load. Try again later.", issues: [] }); setLoading(false); }); });

  const draftLocked = () => busy() || !view()!.cfpOpen;
  const needsProfile = () => !view()?.speaker.value.fullName.trim() || !view()?.speaker.value.bio.trim();
  const markDirty = () => {
    setDirty(true);
    setSaved(false);
    if (error()?.code === "invalid_fields") setError(undefined);
  };
  const updatePresentation = (key: keyof Presentation, value: string) => { setPresentation({ ...presentation(), [key]: value }); markDirty(); };

  const expenseChange = (current: DraftView): ApplicantChanges | undefined => {
    const chosen = expense() || null;
    if (chosen === current.settings.value.companyCoverExpenses) return undefined;
    return { settings: { expectedRevision: current.settings.revision, changes: { preferredContactMethod: current.settings.value.preferredContactMethod, companyCoverExpenses: chosen } } };
  };

  const stepChanges = (current: DraftView): DraftChanges => {
    switch (step()) {
      case 1: return { applicant: {
        speaker: { expectedRevision: current.speaker.revision, changes: { fullName: name().trim(), affiliation: affiliation().trim(), bio: bio().trim(), socialHandles: socialHandles().split("\n").map((value) => value.trim()).filter(Boolean), previousTalks: previousTalks().trim() } },
        settings: { expectedRevision: current.settings.revision, changes: { preferredContactMethod: contact().trim() } },
      } };
      case 2: return { fields: { title: presentation().title, abstract: presentation().abstract, keyTakeaways: presentation().keyTakeaways, technicalRequirements: presentation().technicalRequirements } };
      case 3: return {
        fields: { previousPresentation: presentation().previousPresentation, organizerNotes: presentation().organizerNotes, additionalInfo: presentation().additionalInfo },
        applicant: expenseChange(current),
      };
      default: return {};
    }
  };

  const saveChanges = async (current: DraftView, changes: DraftChanges) => {
    let result: ActionResult<DraftView>;
    try {
      result = await saveDraft(draftSaveInput(current, changes));
    } catch {
      setError({ code: "unavailable", message: "The save request failed. Your changes remain on this page. Try again.", issues: [] });
      setBusy(false);
      return undefined;
    }
    if (!result.ok) {
      setError({ code: result.error.code, message: result.error.message, issues: result.error.issues });
      setBusy(false);
      return undefined;
    }
    return result.value;
  };

  const showSavedDraft = (savedView: DraftView, target?: Step) => {
    setError(undefined);
    setView(savedView);
    if (savedView.draft.state.kind === "active") setPresentation(savedView.draft.state.presentation);
    fillApplicantForm(savedView);
    setDirty(false);
    setSaved(!target);
  };

  const persist = async (target?: Step) => {
    const current = view();
    if (!current || current.draft.state.kind !== "active" || busy()) return false;
    if (!current.cfpOpen) {
      setError({ code: "cfp_closed", message: "The CFP is closed. Your unsaved values remain on this page, but draft changes are blocked.", issues: [] });
      return false;
    }
    setBusy(true);
    setError(undefined);
    const changes = stepChanges(current);
    if (changes.applicant || changes.fields) {
      const savedView = await saveChanges(current, changes);
      if (!savedView) return false;
      showSavedDraft(savedView, target);
    }
    if (target) setStep(target);
    setBusy(false);
    return true;
  };

  const goNext = async (event: SubmitEvent) => {
    event.preventDefault();
    const currentStep = step();
    if (currentStep === 2) {
      const plainAbstract = presentation().abstract.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").trim();
      const plainTakeaways = presentation().keyTakeaways.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").trim();
      if (!plainAbstract || !plainTakeaways) {
        setError({ code: "invalid_fields", message: "Add both an abstract and key takeaways before you continue.", issues: [{ field: !plainAbstract ? "presentation.abstract" : "presentation.keyTakeaways", message: "This field is required." }] });
        document.querySelector<HTMLElement>(!plainAbstract ? '[aria-label="Abstract"]' : '[aria-label="Key takeaways"]')?.focus();
        return;
      }
    }
    if (currentStep < 4) await persist((currentStep + 1) as Step);
  };

  const goBack = async () => {
    const currentStep = step();
    if (currentStep <= 1) { navigate("/applications"); return; }
    if (currentStep === 4) { setStep(3); return; }
    await persist((currentStep - 1) as Step);
  };

  const submit = async () => {
    const current = view();
    if (!current || current.draft.state.kind !== "active" || busy()) return;
    if (!current.cfpOpen) {
      setError({ code: "cfp_closed", message: "The CFP is closed. Your saved application remains available, but submission is blocked.", issues: [] });
      return;
    }
    setBusy(true);
    setError(undefined);
    let result: ActionResult<SubmissionReceipt>;
    try {
      result = await submitDraft({ draftId: current.draft.id, expected: { draft: current.draft.revision, speaker: current.speaker.revision, settings: current.settings.revision } });
    } catch {
      setError({ code: "unavailable", message: "The submission request failed. Your saved draft remains available. Try again.", issues: [] });
      setBusy(false);
      return;
    }
    if (result.ok) {
      setError(undefined);
      setReceipt(result.value);
      setView({ ...current, draft: { ...current.draft, state: { kind: "committed", receipt: result.value } } });
      setDirty(false);
    } else setError({ code: result.error.code, message: result.error.message, issues: result.error.issues });
    setBusy(false);
  };

  const reload = () => {
    if (dirty() && !window.confirm("Discard your unsaved changes and reload the saved draft?")) return;
    void load();
  };
  const setField = (setter: (value: string) => void, value: string) => { setter(value); markDirty(); };
  useBeforeLeave((event) => {
    if (event.defaultPrevented) return;
    if (busy()) {
      event.preventDefault();
      setError({ code: "pending", message: "A save is in progress. Wait for it to finish before you leave.", issues: [] });
      return;
    }
    if (!dirty()) return;
    event.preventDefault();
    setTimeout(() => {
      if (window.confirm("Discard unsaved changes and leave this draft?")) event.retry(true);
    }, 0);
  });
  onSettled(() => {
    if (typeof window === "undefined") return;
    const preventDataLoss = (event: BeforeUnloadEvent) => {
      if (!dirty()) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventDataLoss);
    return () => window.removeEventListener("beforeunload", preventDataLoss);
  });

  const bandTitle = () => {
    const current = view();
    if (!current || blocksPage(error())) return "Proposal draft";
    if (receipt()) return receipt()!.operation === "created" ? "Your talk is in." : "Your changes are in.";
    if (current.draft.state.kind !== "active") return "Proposal draft";
    return current.draft.purpose.kind === "edit" ? "Edit your proposal" : "New talk proposal";
  };
  const bandLede = () => {
    const current = view();
    if (!current || blocksPage(error())) return undefined;
    if (receipt()) return "Thank you. We also email you a confirmation.";
    if (current.draft.state.kind !== "active") return undefined;
    return "Your draft saves each time you go to the next step. Your details save to your profile, so you fill them in once.";
  };

  return <>
    <PageBand size="short" title={bandTitle()} lede={bandLede()} />
    <div class="page-crumbs"><a class="inline-link" href="/applications">Back to your proposals</a></div>
    <Show when={loading()}><div class="cfp-loading" role="status">Loading saved draft…</div></Show>
    <Show when={error()}>{(current) => <>
      <ErrorNotice message={current().message} issues={current().issues} onRetry={RELOADABLE_ERRORS.has(current().code) ? reload : undefined} retryLabel="Reload saved draft" />
      <Show when={current().code === "unauthenticated"}><a class="inline-link" href={`/auth/login?returnTo=${encodeURIComponent(`/apply/${params.id ?? ""}`)}`} rel="external">Sign in to continue</a></Show>
      <Show when={current().code === "finalized" && editTargetId()}><a class="inline-link" href={`/applications/${editTargetId()}`}>Open the proposal to reuse it in a new draft.</a></Show>
    </>}</Show>
    <Show when={view() && !blocksPage(error())}>
      <Show when={receipt()}>
        <section class="surface cfp-stack receipt" aria-labelledby="receipt-title">
          <p class="receipt-talk">{presentation().title || "Untitled talk"}</p>
          <h2 id="receipt-title">What happens next</h2>
          <ol class="receipt-steps">
            <li><span>Reviewers score your proposal against six criteria. They do not see your name.</span></li>
            <li><span>The organizers decide after the reviews. Your proposal shows <strong>Pending</strong> until then.</span></li>
            <li><span>You can edit your proposal while it is pending. Edits stay in a private draft until you submit them again.</span></li>
          </ol>
          <p class="hint">Submitted {new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(receipt()!.committedAt)}.</p>
          <div class="row"><a class="button" href={`/applications/${receipt()!.applicationId}`}>View your proposal</a><a class="button button-secondary" href="/applications">All your proposals</a></div>
        </section>
      </Show>
      <Show when={view()!.draft.state.kind === "active"}>
        <ol class="cfp-progress" aria-label="Proposal progress">
          <For each={steps}>{(label, index) => <li class={step() > index() + 1 ? "is-complete" : undefined} aria-current={step() === index() + 1 ? "step" : undefined}><span class="progress-step">{index() + 1}</span><span>{label}</span></li>}</For>
        </ol>
        <Show when={saved()}><p class="alert" role="status" aria-live="polite">Draft saved to your account.</p></Show>
        <Show when={!view()!.cfpOpen}><div class="alert" role="status">Submissions are closed. You can read this draft, but you cannot save or submit it. You can still <a href="/profile">edit your profile</a>.</div></Show>
        <Show when={view()!.cfpOpen} fallback={
          <section class="surface cfp-stack" aria-label="Saved draft details">
            <section class="confirm-section"><h2>About you</h2><SpeakerSummary speaker={view()!.speaker.value} email={view()!.email} /><SettingsSummary settings={view()!.settings.value} editHref="/profile" /></section>
            <Show when={savedPresentation()}><section class="confirm-section"><h2>Talk</h2><PresentationSummary presentation={savedPresentation()!} /></section></Show>
          </section>
        }>
        <Switch>
          <Match when={step() === 1}>
            <form class="surface form" onSubmit={goNext}>
              <div><h2>About you</h2><p class="muted">We reuse these details for all your proposals. Changes here update your profile.</p></div>
              <div class="field"><label for="app-email">Account email</label><input id="app-email" class="control" type="email" value={view()!.email} disabled autocomplete="email" /></div>
              <div class="field"><label for="app-name">Full name <span class="required">Required</span></label><input id="app-name" class="control" name="fullName" autocomplete="name" maxlength="200" required value={name()} onInput={(event) => setField(setName, event.currentTarget.value)} /></div>
              <div class="field"><label for="app-affiliation">Affiliation</label><input id="app-affiliation" class="control" name="affiliation" autocomplete="organization-title" maxlength="500" value={affiliation()} onInput={(event) => setField(setAffiliation, event.currentTarget.value)} /></div>
              <div class="field"><label for="app-bio">Short bio <span class="required">Required</span></label><p class="hint" id="app-bio-help">Your bio can appear publicly if your talk is accepted.</p><textarea id="app-bio" class="control" name="bio" maxlength="50000" required aria-describedby="app-bio-help" value={bio()} onInput={(event) => setField(setBio, event.currentTarget.value)} /></div>
              <div class="field"><label for="app-social">Social links</label><p class="hint" id="app-social-help">Enter one link per line.</p><textarea id="app-social" class="control" name="socialHandles" maxlength="15000" aria-describedby="app-social-help" value={socialHandles()} onInput={(event) => setField(setSocialHandles, event.currentTarget.value)} /></div>
              <div class="field"><label for="app-talks">Previous talks</label><p class="hint" id="app-talks-help">Add links to talks you gave before.</p><textarea id="app-talks" class="control" name="previousTalks" maxlength="50000" aria-describedby="app-talks-help" value={previousTalks()} onInput={(event) => setField(setPreviousTalks, event.currentTarget.value)} /></div>
              <div class="field"><label for="app-contact">Preferred contact method</label><p class="hint" id="app-contact-help">How the organizers should reach you, for example email or phone.</p><input id="app-contact" class="control" name="preferredContactMethod" maxlength="500" aria-describedby="app-contact-help" value={contact()} onInput={(event) => setField(setContact, event.currentTarget.value)} /></div>
              <DraftFormActions busy={busy()} locked={draftLocked()} next="Next: Talk" nextWhileSaving="Saving…" onBack={goBack} onSave={() => void persist()} />
            </form>
          </Match>
          <Match when={step() === 2}>
            <form class="surface form" onSubmit={goNext}>
              <div><h2>Talk</h2><p class="muted">Describe your talk for the reviewers and future attendees.</p></div>
              <Show when={!needsProfile()}><p class="speaking-as">Speaking as <strong>{view()!.speaker.value.fullName}</strong>. <button type="button" class="inline-link link-button" disabled={draftLocked()} onClick={() => void persist(1)}>Change your details</button></p></Show>
              <div class="field"><label for="proposal-title">Talk title <span class="required">Required</span></label><input id="proposal-title" class="control" name="title" maxlength="500" required value={presentation().title} onInput={(event) => updatePresentation("title", event.currentTarget.value)} /></div>
              <div class="field"><label>Abstract <span class="required">Required</span></label><p class="hint" id="abstract-help">Use the formatting controls to make your abstract easy to scan.</p><RichEditor label="Abstract" name="abstract" value={presentation().abstract} required descriptionId="abstract-help" onInput={(html) => updatePresentation("abstract", html)} /></div>
              <div class="field"><label>Key takeaways <span class="required">Required</span></label><p class="hint" id="takeaways-help">List the main points attendees will learn.</p><RichEditor label="Key takeaways" name="keyTakeaways" value={presentation().keyTakeaways} required descriptionId="takeaways-help" onInput={(html) => updatePresentation("keyTakeaways", html)} /></div>
              <div class="field"><label for="proposal-tech">Technical requirements</label><p class="hint" id="proposal-tech-help">Describe special equipment or setup needs.</p><textarea id="proposal-tech" class="control" name="technicalRequirements" maxlength="50000" aria-describedby="proposal-tech-help" value={presentation().technicalRequirements} onInput={(event) => updatePresentation("technicalRequirements", event.currentTarget.value)} /></div>
              <DraftFormActions busy={busy()} locked={draftLocked()} next="Next: Experience and travel" nextWhileSaving="Saving…" onBack={goBack} onSave={() => void persist()} />
            </form>
          </Match>
          <Match when={step() === 3}>
            <form class="surface form" onSubmit={goNext}>
              <div><h2>Experience and travel</h2><p class="muted">First-time speakers are welcome. Your answers here do not change how reviewers score your talk.</p></div>
              <div class="field"><label class="label-question" for="previous-presentation">Have you given this talk before?</label><textarea id="previous-presentation" class="control" name="previousPresentation" maxlength="50000" value={presentation().previousPresentation} onInput={(event) => updatePresentation("previousPresentation", event.currentTarget.value)} /></div>
              <fieldset class="field choice-fieldset"><legend class="label-question">Can your company cover travel or accommodation? <span class="required">Required</span></legend><p class="hint" id="expenses-help">We save this answer to your profile for your next proposal.</p><div class="choice-grid" role="radiogroup" aria-describedby="expenses-help"><For each={expenseOptions}>{(option, index) => <label class="choice"><input type="radio" name="companyCoverExpenses" value={option} required={index() === 0} checked={expense() === option} onChange={() => { setExpense(option); markDirty(); }} /><span>{option}</span></label>}</For></div></fieldset>
              <div class="field"><label for="organizer-notes">Notes for organizers</label><p class="hint" id="organizer-notes-help">Private to the organizers. Add a visa invitation request or availability constraints if relevant.</p><textarea id="organizer-notes" class="control" name="organizerNotes" maxlength="50000" aria-describedby="organizer-notes-help" value={presentation().organizerNotes} onInput={(event) => updatePresentation("organizerNotes", event.currentTarget.value)} /></div>
              <div class="field"><label for="additional-info">Additional information</label><textarea id="additional-info" class="control" name="additionalInfo" maxlength="50000" value={presentation().additionalInfo} onInput={(event) => updatePresentation("additionalInfo", event.currentTarget.value)} /></div>
              <DraftFormActions busy={busy()} locked={draftLocked()} next="Review proposal" onBack={goBack} onSave={() => void persist()} />
            </form>
          </Match>
          <Match when={step() === 4}>
            <section class="surface cfp-stack">
              <div><h2>Review</h2><p class="muted">Check everything once more. You can still edit after you submit, while your proposal is pending.</p></div>
              <section class="confirm-section"><div class="surface-title"><h3>About you</h3><button class="inline-link link-button" type="button" onClick={() => setStep(1)}>Edit your details</button></div><SpeakerSummary speaker={view()!.speaker.value} email={view()!.email} /><SettingsSummary settings={view()!.settings.value} /></section>
              <section class="confirm-section"><div class="surface-title"><h3>Talk</h3><button class="inline-link link-button" type="button" onClick={() => setStep(2)}>Edit talk</button></div><PresentationSummary presentation={presentation()} /></section>
              <div class="form-actions"><button type="button" class="button button-secondary" onClick={goBack}>Back</button><button type="button" class="button" disabled={draftLocked()} onClick={() => void submit()}>{busy() ? "Submitting…" : view()!.draft.purpose.kind === "edit" ? "Submit changes" : "Submit proposal"}</button></div>
            </section>
          </Match>
        </Switch>
        </Show>
      </Show>
    </Show>
  </>;
}

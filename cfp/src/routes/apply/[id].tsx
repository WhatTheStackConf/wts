import { createSignal, For, Match, onSettled, Show, Switch } from "solid-js";
import { useBeforeLeave, useNavigate, useParams } from "@solidjs/router";
import { getDraft, saveDraft, submitDraft } from "~/lib/cfp-actions";
import type { ActionResult } from "~/lib/account-model";
import type { DraftView, Presentation, SubmissionReceipt } from "~/lib/cfp-model";
import { ErrorNotice, PresentationSummary, SettingsSummary, SpeakerSummary } from "~/components/ApplicantUI";
import { RichEditor } from "~/components/RichEditor";

const steps = ["Intro", "Personal", "Proposal", "Experience", "Expenses", "Confirm"] as const;
type Step = 1 | 2 | 3 | 4 | 5 | 6;

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
  const [error, setError] = createSignal<{ code: string; message: string; issues: { field: string; message: string }[] }>();
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [skipPersonal, setSkipPersonal] = createSignal(false);
  const [receipt, setReceipt] = createSignal<SubmissionReceipt | undefined>(undefined);
  const savedPresentation = () => {
    const state = view()?.draft.state;
    return state?.kind === "active" ? state.presentation : undefined;
  };
  const editTargetId = () => {
    const purpose = view()?.draft.purpose;
    return purpose?.kind === "edit" ? purpose.targetId : undefined;
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
      setName(next.speaker.value.fullName);
      setAffiliation(next.speaker.value.affiliation);
      setBio(next.speaker.value.bio);
      setSocialHandles(next.speaker.value.socialHandles.join("\n"));
      setPreviousTalks(next.speaker.value.previousTalks);
      setContact(next.settings.value.preferredContactMethod);
      setExpense(next.settings.value.companyCoverExpenses ?? "");
      if (next.draft.state.kind === "active") setPresentation(next.draft.state.presentation);
      const profileComplete = Boolean(next.speaker.value.fullName.trim() && next.speaker.value.bio.trim());
      setSkipPersonal(profileComplete);
      if (next.draft.state.kind === "committed") setReceipt(next.draft.state.receipt);
      setStep(1);
      setDirty(false);
      setSaved(false);
    } catch {
      setError({ code: "unavailable", message: "The saved draft could not load. Try again later.", issues: [] });
    }
    setLoading(false);
  };

  onSettled(() => { void load().catch(() => { setError({ code: "unavailable", message: "The saved draft could not load. Try again later.", issues: [] }); setLoading(false); }); });

  const needsProfile = () => !view()?.speaker.value.fullName.trim() || !view()?.speaker.value.bio.trim();
  const markDirty = () => {
    setDirty(true);
    setSaved(false);
    if (error()?.code === "invalid_fields") setError(undefined);
  };
  const updatePresentation = (key: keyof Presentation, value: string) => { setPresentation({ ...presentation(), [key]: value }); markDirty(); };

  const persist = async (target?: Step) => {
    const current = view();
    if (!current || current.draft.state.kind !== "active" || busy()) return false;
    if (!current.cfpOpen) {
      setError({ code: "cfp_closed", message: "The CFP is closed. Your unsaved values remain on this page, but draft changes are blocked.", issues: [] });
      return false;
    }
    setBusy(true);
    setError(undefined);
    let applicant: { speaker?: { expectedRevision: number; changes: { fullName: string; affiliation: string; bio: string; socialHandles: string[]; previousTalks: string } }; settings?: { expectedRevision: number; changes: { preferredContactMethod: string; companyCoverExpenses?: "Yes" | "No" | "Other" | null } } } | undefined;
    let fields: Partial<Presentation> | undefined;
    if (step() === 2) {
      applicant = {
        speaker: { expectedRevision: current.speaker.revision, changes: { fullName: name().trim(), affiliation: affiliation().trim(), bio: bio().trim(), socialHandles: socialHandles().split("\n").map((value) => value.trim()).filter(Boolean), previousTalks: previousTalks().trim() } },
        settings: { expectedRevision: current.settings.revision, changes: { preferredContactMethod: contact().trim() } },
      };
    }
    if (step() === 3) fields = { title: presentation().title, abstract: presentation().abstract, keyTakeaways: presentation().keyTakeaways, technicalRequirements: presentation().technicalRequirements };
    if (step() === 4) fields = { previousPresentation: presentation().previousPresentation };
    if (step() === 5) {
      fields = { organizerNotes: presentation().organizerNotes, additionalInfo: presentation().additionalInfo };
      if (current.settings.value.companyCoverExpenses === null) {
        applicant = { settings: { expectedRevision: current.settings.revision, changes: { preferredContactMethod: contact().trim(), companyCoverExpenses: expense() || null } } };
      }
    }
    if (!applicant && !fields) {
      if (target) setStep(target);
      setBusy(false);
      return true;
    }
    let result: ActionResult<DraftView>;
    try {
      result = await saveDraft({ draftId: current.draft.id, expectedDraftRevision: current.draft.revision, ...(fields ? { presentation: fields } : {}), ...(applicant ? { applicant } : {}) });
    } catch {
      setError({ code: "unavailable", message: "The save request failed. Your changes remain on this page. Try again.", issues: [] });
      setBusy(false);
      return false;
    }
    if (!result.ok) {
      setError({ code: result.error.code, message: result.error.message, issues: result.error.issues });
      setBusy(false);
      return false;
    }
    setError(undefined);
    setView(result.value);
    if (result.value.draft.state.kind === "active") setPresentation(result.value.draft.state.presentation);
    setExpense(result.value.settings.value.companyCoverExpenses ?? "");
    setContact(result.value.settings.value.preferredContactMethod);
    setName(result.value.speaker.value.fullName);
    setAffiliation(result.value.speaker.value.affiliation);
    setBio(result.value.speaker.value.bio);
    setSocialHandles(result.value.speaker.value.socialHandles.join("\n"));
    setPreviousTalks(result.value.speaker.value.previousTalks);
    setDirty(false);
    setSaved(!target);
    if (target) setStep(target);
    setBusy(false);
    return true;
  };

  const goNext = async (event: SubmitEvent) => {
    event.preventDefault();
    const currentStep = step();
    if (currentStep === 3) {
      const plainAbstract = presentation().abstract.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").trim();
      const plainTakeaways = presentation().keyTakeaways.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").trim();
      if (!plainAbstract || !plainTakeaways) {
        setError({ code: "invalid_fields", message: "Add both an abstract and key takeaways before you continue.", issues: [{ field: !plainAbstract ? "presentation.abstract" : "presentation.keyTakeaways", message: "This field is required." }] });
        document.querySelector<HTMLElement>(!plainAbstract ? '[aria-label="Abstract"]' : '[aria-label="Key takeaways"]')?.focus();
        return;
      }
    }
    if (currentStep === 5) { await persist(6); return; }
    if (currentStep < 5) await persist((currentStep + 1) as Step);
  };

  const goBack = async () => {
    const currentStep = step();
    if (currentStep <= 1) { navigate("/applications"); return; }
    if (currentStep === 6) { setStep(5); return; }
    if (currentStep === 3) { await persist(skipPersonal() ? 1 : 2); return; }
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
  const saveAndOpen = async (event: MouseEvent, destination: string) => {
    event.preventDefault();
    if (!view()?.cfpOpen) {
      navigate(destination);
      return;
    }
    if (await persist()) navigate(destination);
  };
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

  return <>
    <a class="inline-link" href="/applications">Back to applications</a>
    <Show when={loading()}><div class="cfp-loading" role="status">Loading saved draft…</div></Show>
    <Show when={error()}>
      <ErrorNotice message={error()?.message} issues={error()?.issues} onRetry={error()?.code === "conflict" || error()?.code === "unavailable" ? reload : undefined} retryLabel="Reload saved draft" />
      <Show when={error()?.code === "unauthenticated"}><a class="inline-link" href={`/auth/login?returnTo=${encodeURIComponent(`/apply/${params.id ?? ""}`)}`} rel="external">Sign in to continue</a></Show>
      <Show when={error()?.code === "finalized" && editTargetId()}><a class="inline-link" href={`/applications/${editTargetId()}`}>Open the application to create a Reuse draft.</a></Show>
    </Show>
    <Show when={view() && error()?.code !== "unauthenticated" && error()?.code !== "unavailable"}>
      <Show when={receipt()}>
        <header class="page-heading"><h1>Submission received</h1><p>Your submission receipt is saved with this draft.</p></header>
        <section class="surface cfp-stack" aria-labelledby="receipt-title">
          <h2 id="receipt-title">Submission receipt</h2>
          <dl class="read-only-summary"><div><dt>Application</dt><dd><a href={`/applications/${receipt()!.applicationId}`}>{receipt()!.applicationId}</a></dd></div><div><dt>Operation</dt><dd>{receipt()!.operation}</dd></div><div><dt>Application revision</dt><dd>{receipt()!.applicationRevision}</dd></div><div><dt>Committed</dt><dd>{new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(receipt()!.committedAt)}</dd></div></dl>
          <div class="row"><a class="button" href={`/applications/${receipt()!.applicationId}`}>View submitted application</a><a class="button button-secondary" href="/applications">Return to applications</a></div>
        </section>
      </Show>
      <Show when={view()!.draft.state.kind === "active"}>
        <header class="page-heading"><h1>{view()!.draft.purpose.kind === "edit" ? "Edit pending application" : "New talk application"}</h1><p>Complete each step and save before you continue. Your presentation stays separate from your reusable speaker profile.</p></header>
        <ol class="cfp-progress" aria-label="Application progress">
          <For each={steps}>{(label, index) => <li class={step() > index() + 1 ? "is-complete" : undefined} aria-current={step() === index() + 1 ? "step" : undefined}><span class="progress-step">{index() + 1}</span><span>{label}</span></li>}</For>
        </ol>
        <Show when={saved()}><p class="alert" role="status" aria-live="polite">Draft saved to your account.</p></Show>
        <Show when={!view()!.cfpOpen}><div class="alert" role="status">The CFP is closed. You can read this draft, but the server blocks draft saves and submissions. <a href="/profile">Edit profile</a> and <a href="/settings">edit settings</a> remain available.</div></Show>
        <Show when={view()!.cfpOpen} fallback={
          <section class="surface cfp-stack" aria-label="Saved draft details">
            <section class="confirm-section"><h2>Speaker profile</h2><SpeakerSummary speaker={view()!.speaker.value} email={view()!.email} editHref="/profile" /></section>
            <section class="confirm-section"><h2>Applicant settings</h2><SettingsSummary settings={view()!.settings.value} editHref="/settings" /></section>
            <Show when={savedPresentation()}><section class="confirm-section"><h2>Presentation</h2><PresentationSummary presentation={savedPresentation()!} /></section></Show>
          </section>
        }>
        <Switch>
          <Match when={step() === 1}>
            <section class="surface cfp-stack"><h2>Introduction</h2><p class="muted">Submit a software-development talk proposal. Review the saved applicant information before you continue.</p>
              <Show when={!needsProfile()} fallback={<p class="muted">Complete your reusable speaker profile before you enter a proposal.</p>}>
                <section class="confirm-section"><h3>Saved speaker profile</h3><SpeakerSummary speaker={view()!.speaker.value} email={view()!.email} editHref="/profile" /></section>
                <section class="confirm-section"><h3>Saved applicant settings</h3><SettingsSummary settings={view()!.settings.value} editHref="/settings" /></section>
              </Show>
              <div class="form-actions"><a class="button button-secondary" href="/applications">Cancel</a><button type="button" class="button" onClick={() => setStep(needsProfile() ? 2 : 3)}>Continue</button></div>
            </section>
          </Match>
          <Match when={step() === 2}>
            <form class="surface form" onSubmit={goNext}>
              <div><h2>Personal</h2><p class="muted">These details are reusable across your applications. Changes update your speaker profile.</p></div>
              <div class="field"><label for="app-email">Account email</label><input id="app-email" class="control" type="email" value={view()!.email} disabled autocomplete="email" /></div>
              <div class="field"><label for="app-name">Full name <span class="required">Required</span></label><input id="app-name" class="control" name="fullName" autocomplete="name" maxlength="200" required value={name()} onInput={(event) => setField(setName, event.currentTarget.value)} /></div>
              <div class="field"><label for="app-affiliation">Affiliation</label><input id="app-affiliation" class="control" name="affiliation" autocomplete="organization-title" maxlength="500" value={affiliation()} onInput={(event) => setField(setAffiliation, event.currentTarget.value)} /></div>
              <div class="field"><label for="app-bio">Short bio <span class="required">Required</span></label><p class="hint" id="app-bio-help">Your bio can appear publicly if your talk is accepted.</p><textarea id="app-bio" class="control" name="bio" maxlength="50000" required aria-describedby="app-bio-help" value={bio()} onInput={(event) => setField(setBio, event.currentTarget.value)} /></div>
              <div class="field"><label for="app-social">Social links</label><p class="hint" id="app-social-help">Enter one link per line.</p><textarea id="app-social" class="control" name="socialHandles" maxlength="15000" aria-describedby="app-social-help" value={socialHandles()} onInput={(event) => setField(setSocialHandles, event.currentTarget.value)} /></div>
              <div class="field"><label for="app-talks">Previous talks</label><p class="hint" id="app-talks-help">Add links to past talks or speaker profiles. This information is saved to your reusable profile.</p><textarea id="app-talks" class="control" name="previousTalks" maxlength="50000" aria-describedby="app-talks-help" value={previousTalks()} onInput={(event) => setField(setPreviousTalks, event.currentTarget.value)} /></div>
              <div class="field"><label for="app-contact">Preferred contact method</label><input id="app-contact" class="control" name="preferredContactMethod" maxlength="500" value={contact()} onInput={(event) => setField(setContact, event.currentTarget.value)} /><a class="inline-link" href="/settings" onClick={(event) => void saveAndOpen(event, "/settings")}>Edit general settings</a></div>
              <div class="form-actions"><button type="button" class="button button-secondary" onClick={goBack}>Back</button><button type="button" class="button button-secondary" disabled={busy() || !view()!.cfpOpen} onClick={() => void persist()}>{busy() ? "Saving…" : "Save draft"}</button><button type="submit" class="button" disabled={busy() || !view()!.cfpOpen}>{busy() ? "Saving…" : "Next: Proposal"}</button></div>
            </form>
          </Match>
          <Match when={step() === 3}>
            <form class="surface form" onSubmit={goNext}>
              <div><h2>Proposal</h2><p class="muted">Describe your talk for the selection committee and future attendees.</p></div>
              <div class="field"><label for="proposal-title">Talk title <span class="required">Required</span></label><input id="proposal-title" class="control" name="title" maxlength="500" required value={presentation().title} onInput={(event) => updatePresentation("title", event.currentTarget.value)} /></div>
              <div class="field"><label>Abstract <span class="required">Required</span></label><p class="hint" id="abstract-help">Use the formatting controls to make your abstract easy to scan.</p><RichEditor label="Abstract" name="abstract" value={presentation().abstract} required descriptionId="abstract-help" onInput={(html) => updatePresentation("abstract", html)} /></div>
              <div class="field"><label>Key takeaways <span class="required">Required</span></label><p class="hint" id="takeaways-help">List the main points attendees will learn.</p><RichEditor label="Key takeaways" name="keyTakeaways" value={presentation().keyTakeaways} required descriptionId="takeaways-help" onInput={(html) => updatePresentation("keyTakeaways", html)} /></div>
              <div class="field"><label for="proposal-tech">Technical requirements</label><p class="hint" id="proposal-tech-help">Describe special equipment or setup needs.</p><textarea id="proposal-tech" class="control" name="technicalRequirements" maxlength="50000" aria-describedby="proposal-tech-help" value={presentation().technicalRequirements} onInput={(event) => updatePresentation("technicalRequirements", event.currentTarget.value)} /></div>
              <div class="form-actions"><button type="button" class="button button-secondary" onClick={goBack}>Back</button><button type="button" class="button button-secondary" disabled={busy() || !view()!.cfpOpen} onClick={() => void persist()}>{busy() ? "Saving…" : "Save draft"}</button><button type="submit" class="button" disabled={busy() || !view()!.cfpOpen}>{busy() ? "Saving…" : "Next: Experience"}</button></div>
            </form>
          </Match>
          <Match when={step() === 4}>
            <form class="surface form" onSubmit={goNext}>
              <div><h2>Experience</h2><p class="muted">First-time speakers are welcome. Previous speaking experience is optional.</p></div>
              <div class="field"><label for="previous-presentation">Have you presented this topic before?</label><textarea id="previous-presentation" class="control" name="previousPresentation" maxlength="50000" value={presentation().previousPresentation} onInput={(event) => updatePresentation("previousPresentation", event.currentTarget.value)} /></div>
              <section class="confirm-section"><h3>Previous talks in your speaker profile</h3><p>{previousTalks().trim() || <span class="muted">Not provided</span>}</p><a class="inline-link" href="/profile" onClick={(event) => void saveAndOpen(event, "/profile")}>Edit speaker profile</a></section>
              <div class="form-actions"><button type="button" class="button button-secondary" onClick={goBack}>Back</button><button type="button" class="button button-secondary" disabled={busy() || !view()!.cfpOpen} onClick={() => void persist()}>{busy() ? "Saving…" : "Save draft"}</button><button type="submit" class="button" disabled={busy() || !view()!.cfpOpen}>{busy() ? "Saving…" : "Next: Expenses"}</button></div>
            </form>
          </Match>
          <Match when={step() === 5}>
            <form class="surface form" onSubmit={goNext}>
              <div><h2>Expenses</h2><p class="muted">Tell the organizers whether your company can cover travel or accommodation.</p></div>
              <Show when={view()!.settings.value.companyCoverExpenses === null} fallback={<section class="confirm-section"><h3>Saved applicant settings</h3><SettingsSummary settings={view()!.settings.value} editHref="/settings" /></section>}>
                <fieldset class="field" style={{ border: "none", padding: 0, margin: 0 }}><legend>Can your company cover travel or accommodation? <span class="required">Required</span></legend><p class="hint" id="expenses-help">Choose one option before you review your application.</p><div class="choice-grid" role="radiogroup" aria-describedby="expenses-help"><For each={["Yes", "No", "Other"] as const}>{(option, index) => <label class="choice"><input type="radio" name="companyCoverExpenses" value={option} required={index() === 0} checked={expense() === option} onChange={() => { setExpense(option); markDirty(); }} /><span>{option}</span></label>}</For></div></fieldset>
              </Show>
              <div class="field"><label for="organizer-notes">Notes for organizers</label><p class="hint" id="organizer-notes-help">Private to the organizers. Add a visa invitation request or availability constraints if relevant.</p><textarea id="organizer-notes" class="control" name="organizerNotes" maxlength="50000" aria-describedby="organizer-notes-help" value={presentation().organizerNotes} onInput={(event) => updatePresentation("organizerNotes", event.currentTarget.value)} /></div>
              <div class="field"><label for="additional-info">Additional information</label><textarea id="additional-info" class="control" name="additionalInfo" maxlength="50000" value={presentation().additionalInfo} onInput={(event) => updatePresentation("additionalInfo", event.currentTarget.value)} /></div>
              <div class="form-actions"><button type="button" class="button button-secondary" onClick={goBack}>Back</button><button type="button" class="button button-secondary" disabled={busy() || !view()!.cfpOpen} onClick={() => void persist()}>{busy() ? "Saving…" : "Save draft"}</button><button type="submit" class="button" disabled={busy() || !view()!.cfpOpen}>Review application</button></div>
            </form>
          </Match>
          <Match when={step() === 6}>
            <section class="surface cfp-stack">
              <div><h2>Confirm</h2><p class="muted">Review every profile, setting, and presentation field before you submit.</p></div>
              <section class="confirm-section"><div class="surface-title"><h3>Speaker profile</h3><a class="inline-link" href="/profile">Edit profile</a></div><SpeakerSummary speaker={view()!.speaker.value} email={view()!.email} /></section>
              <section class="confirm-section"><div class="surface-title"><h3>Applicant settings</h3><a class="inline-link" href="/settings">Edit settings</a></div><SettingsSummary settings={view()!.settings.value} /></section>
              <section class="confirm-section"><div class="surface-title"><h3>Presentation</h3><button class="button button-quiet button-small" type="button" onClick={() => setStep(3)}>Edit presentation</button></div><PresentationSummary presentation={presentation()} /></section>
              <div class="form-actions"><button type="button" class="button button-secondary" onClick={goBack}>Back</button><button type="button" class="button" disabled={busy() || !view()!.cfpOpen} onClick={() => void submit()}>{busy() ? "Submitting…" : view()!.draft.purpose.kind === "edit" ? "Save changes" : "Submit application"}</button></div>
            </section>
          </Match>
        </Switch>
        </Show>
      </Show>
    </Show>
  </>;
}

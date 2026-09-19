import { clientOnly } from "@solidjs/web";
import { Icon } from "~/components/Icon";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import type { MissionCodeRedemptionResult } from "~/lib/mission-code-redemption";
import { redeemMissionCode } from "~/lib/mission-code-redemption-action";
import { MissionQuestionForm } from "~/components/MissionQuestionForm";
import { missionRetrySeconds, type MissionQuestionChallenge } from "~/lib/mission-questions";
import { grantMyPartnerContactConsent } from "~/lib/partner-contact-consent-actions";
import {
  clearPendingMissionCode,
  missionCodeFromFragment,
  readPendingMissionCode,
  savePendingMissionCode,
  setMissionCodeLoginResume,
} from "~/lib/mission-code-resume";

const RedeemMissionPage = () => {
  const auth = useAuth();
  const [code, setCode] = createSignal("");
  const [pendingVersion, setPendingVersion] = createSignal(0);
  const [isRedeeming, setIsRedeeming] = createSignal(false);
  const [result, setResult] = createSignal<MissionCodeRedemptionResult>();
  const [challenge, setChallenge] = createSignal<{ value: MissionQuestionChallenge; userId: string; sourceCode: string }>();
  // A scanned/login-resumed code opens the task, not the manual-entry screen.
  const [scanFlow, setScanFlow] = createSignal(typeof window !== "undefined" && Boolean(missionCodeFromFragment(window.location.hash) || readPendingMissionCode(window.sessionStorage)));
  const [retryAt, setRetryAt] = createSignal(0);
  const [tick, setTick] = createSignal(Date.now());
  const retrySeconds = () => missionRetrySeconds(retryAt(), tick());
  const [requestError, setRequestError] = createSignal("");
  const [consentBusy, setConsentBusy] = createSignal(false);
  const [consentMessage, setConsentMessage] = createSignal("");
  const [consentMessageKind, setConsentMessageKind] = createSignal<"success" | "error">("success");
  let automaticallySubmittedCode: string | undefined;
  let requestErrorRegion: HTMLDivElement | undefined;
  let resultRegion: HTMLDivElement | undefined;

  const pendingCode = () => typeof window === "undefined" ? undefined : readPendingMissionCode(window.sessionStorage);

  const redirectToLogin = (pending: string) => {
    savePendingMissionCode(window.sessionStorage, pending);
    setMissionCodeLoginResume(window.localStorage);
    window.location.assign("/login");
  };

  const applyResult = (redemption: MissionCodeRedemptionResult, userId: string, sourceCode: string) => {
    if (auth.user?.id !== userId) {
      setChallenge(undefined); setResult(undefined);
      setRequestError("Your signed-in User changed. Reload before continuing.");
      return;
    }
    setResult(redemption);
    if (redemption.status === "rate_limited") {
      const now = Date.now();
      setTick(now);
      setRetryAt(now + (redemption.retryAfterSeconds || 60) * 1000);
    }
    if (redemption.questionnaire) { setScanFlow(true); setChallenge({ value: redemption.questionnaire, userId, sourceCode }); setCode(""); }
    else if (redemption.status !== "rate_limited" && redemption.status !== "unavailable") setChallenge(undefined);
    if (pendingCode() === sourceCode && !["rate_limited", "unavailable", "questions_required", "questions_incorrect", "questions_incomplete", "questions_malformed", "question_conflict"].includes(redemption.status)) {
      clearPendingMissionCode(window.sessionStorage);
      setCode("");
      setPendingVersion(value => value + 1);
    }
  };

  const submitCode = async (rawCode: string, sourceHint: "link" | "manual") => {
    if (isRedeeming() || challenge() || retrySeconds() > 0) return;
    const trimmedCode = rawCode.trim();
    if (!trimmedCode) {
      setRequestError("Enter a mission code.");
      return;
    }
    if (!auth.isAuthenticated()) {
      redirectToLogin(trimmedCode);
      return;
    }

    const expectedUserId = auth.user?.id || "";
    savePendingMissionCode(window.sessionStorage, trimmedCode);
    setIsRedeeming(true);
    setRequestError("");
    setResult(undefined);
    try {
      const redemption = await redeemMissionCode(trimmedCode, sourceHint, expectedUserId);
      applyResult(redemption, expectedUserId, trimmedCode);
    } catch (error) {
      // Retain the secret only in this tab so a temporary outage cannot lose a valid scan.
      savePendingMissionCode(window.sessionStorage, trimmedCode);
      setPendingVersion((value) => value + 1);
      setRequestError(error instanceof Error ? error.message : "Could not redeem your code. Check your connection and try again.");
    } finally {
      setIsRedeeming(false);
    }
  };

  const resumePendingCode = () => {
    if (isRedeeming() || challenge() || retrySeconds() > 0) return;
    const pending = pendingCode();
    if (!pending || auth.isLoading()) return;
    if (!auth.isAuthenticated()) {
      redirectToLogin(pending);
      return;
    }
    if (automaticallySubmittedCode === pending) return;
    automaticallySubmittedCode = pending;
    void submitCode(pending, "link");
  };

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    void submitCode(code() || pendingCode() || "", code() ? "manual" : "link");
  };

  const grantPartnerFollowUp = async (event: SubmitEvent, activityId: string) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!new FormData(form).get("partner-follow-up")) {
      setConsentMessage("Select the separate consent checkbox before sharing your contact details.");
      setConsentMessageKind("error");
      return;
    }
    setConsentBusy(true);
    setConsentMessage("");
    try {
      const partnerFollowUp = await grantMyPartnerContactConsent(activityId);
      setResult((current) => current ? { ...current, partnerFollowUp } : current);
      setConsentMessage("Partner follow-up consent recorded. You can withdraw it in your profile before any future WTS handoff.");
      setConsentMessageKind("success");
    } catch (error) {
      setConsentMessage(error instanceof Error ? error.message : "Partner follow-up consent could not be recorded.");
      setConsentMessageKind("error");
    } finally {
      setConsentBusy(false);
    }
  };

  const captureFragmentCode = () => {
    const fragmentCode = missionCodeFromFragment(window.location.hash);
    if (fragmentCode && (isRedeeming() || challenge())) {
      if (fragmentCode !== pendingCode()) setRequestError("Another QR was not submitted. Finish this Mission, then scan the other QR again.");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      return;
    }
    if (fragmentCode) {
      setScanFlow(true);
      automaticallySubmittedCode = undefined;
      setCode("");
      savePendingMissionCode(window.sessionStorage, fragmentCode);
      setPendingVersion((value) => value + 1);
    }
    if (window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    resumePendingCode();
  };

  onSettled(() => {
    captureFragmentCode();
    const timer = window.setInterval(() => setTick(Date.now()), 500);
    window.addEventListener("hashchange", captureFragmentCode);
    return () => { window.clearInterval(timer); window.removeEventListener("hashchange", captureFragmentCode); };
  });

  createEffect(
    () => ({
      loading: auth.isLoading(),
      authenticated: auth.isAuthenticated(),
      version: pendingVersion(),
    }),
    () => resumePendingCode(),
  );

  createEffect(
    () => ({ hasError: Boolean(requestError()), hasResult: Boolean(result()), questionId: result()?.questionnaire?.questions[0]?.id }),
    ({ hasError, hasResult, questionId }) => {
      if (hasError) queueMicrotask(() => requestErrorRegion?.focus());
      else if (questionId) queueMicrotask(() => document.getElementById(`question-${questionId}`)?.focus());
      else if (hasResult) queueMicrotask(() => resultRegion?.focus());
    },
  );

  return (
    <Layout title="Redeem code // WhatTheStack" description="Redeem a WhatTheStack mission code.">
      <div class="w-full px-4 pb-12 pt-4">
        <section class="mx-auto max-w-xl rounded-xl bg-base-200 p-5 md:p-8" aria-labelledby="mission-redeem-heading">
          <h1 id="mission-redeem-heading" class={scanFlow() ? "sr-only" : "text-3xl font-star text-white md:text-4xl"}><Show when={!scanFlow()} fallback="Mission questions">Redeem code</Show></h1>

          <Show when={!scanFlow() && !auth.isLoading() && !auth.isAuthenticated()}>
            <div class="mt-6 rounded-xl border border-secondary-400/25 bg-secondary-500/10 p-4" role="status">
              <p class="text-sm text-secondary-100">Sign in to save your achievement.</p>
              <button type="button" class="btn btn-secondary btn-sm mt-3" onClick={() => redirectToLogin(code() || pendingCode() || "") } disabled={!code() && !pendingCode()}>
                Log in to redeem
              </button>
            </div>
          </Show>

          <Show when={!scanFlow() && !challenge()}>
          <form class="mt-6 space-y-4" onSubmit={handleSubmit} aria-busy={isRedeeming() ? "true" : "false"}>
            <div class="form-control">
              <label class="label" for="mission-code">
                <span class="label-text font-mono text-xs font-bold uppercase tracking-[0.12em] text-primary-200">Mission code</span>
              </label>
              <input
                id="mission-code"
                name="mission-code"
                type="text"
                value={code()}
                onInput={(event) => {
                  setCode(event.currentTarget.value);
                  setRequestError("");
                }}
                class="input input-bordered w-full bg-base-300/50 font-mono uppercase tracking-wide text-white"
                placeholder="WTS26-XXXXXXXX-XXXXXXXX"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck={false}
                disabled={isRedeeming() || Boolean(challenge()) || retrySeconds() > 0}
                aria-describedby={requestError() ? "mission-code-help mission-code-error" : "mission-code-help"}
                aria-invalid={requestError() ? "true" : undefined}
              />
              <p id="mission-code-help" class="mt-2 text-xs leading-relaxed text-secondary-300/75">
                Codes are case-insensitive. Do not share a scanned code in messages or screenshots.
              </p>
            </div>

            <button type="submit" class="btn btn-primary w-full font-mono" disabled={isRedeeming() || Boolean(challenge()) || retrySeconds() > 0}>
              <Show when={!isRedeeming()} fallback={<><span class="loading loading-spinner loading-sm" aria-hidden="true" /> Redeeming…</>}>
                Redeem code
              </Show>
            </button>
          </form>
          </Show>

          <Show when={scanFlow() && !challenge() && !result() && !requestError()}><p class="py-4 text-sm" role="status">Opening mission…</p></Show>
          <Show when={retrySeconds() > 0}><p class="mt-3 text-sm" role="status">Retry available in {retrySeconds()} seconds. No automatic retries.</p></Show>
          <Show when={challenge()?.userId === auth.user?.id ? challenge() : undefined} keyed>{current => <MissionQuestionForm challenge={current.value} userId={current.userId} retrySeconds={retrySeconds()} onResult={value => applyResult(value, current.userId, current.sourceCode)} />}</Show>
          <Show when={["questions_incorrect", "questions_incomplete", "questions_malformed", "question_conflict"].includes(result()?.status || "")}>
            <button type="button" class="btn btn-outline btn-primary mt-4 min-h-12 w-full" disabled={isRedeeming() || retrySeconds() > 0} onClick={() => {
              const pending = pendingCode();
              if (pending) void submitCode(pending, "link");
              else setRequestError("Scan the official code again to start a new question attempt.");
            }}>Try questions again</button>
          </Show>

          <Show when={requestError()}>
            <div ref={requestErrorRegion} id="mission-code-error" class="alert alert-error mt-5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error" role="alert" tabindex="-1">
              <Icon icon="material-symbols:error-outline" aria-hidden="true" />
              <span>{requestError()}</span>
            </div>
          </Show>
          <Show when={scanFlow() && requestError() && !challenge() && !result()}>
            <button type="button" class="btn btn-primary mt-4 min-h-12 w-full" disabled={isRedeeming() || retrySeconds() > 0} onClick={() => void submitCode(pendingCode() || "", "link")}>Retry scan</button>
          </Show>

          <Show when={result()?.status !== "questions_required" ? result() : undefined}>
            {(current) => (
              <div
                ref={resultRegion}
                class={`mt-5 rounded-xl border p-5 ${current().status === "accepted" || current().status === "already_redeemed" ? "border-success/30 bg-success/10" : "border-warning/30 bg-warning/10"}`}
                role={current().status === "accepted" || current().status === "already_redeemed" ? "status" : "alert"}
                aria-live="polite"
                tabindex="-1"
              >
                <div class="flex gap-3">
                  <Icon
                    icon={current().status === "accepted" || current().status === "already_redeemed" ? "material-symbols:check-circle-outline" : "material-symbols:info-outline"}
                    class="mt-0.5 text-xl"
                    aria-hidden="true"
                  />
                  <div class="min-w-0">
                    <h2 class="font-mono text-sm font-bold uppercase tracking-[0.1em]">{current().title}</h2>
                    <p class="mt-2 text-sm leading-relaxed">{current().message}</p>
                    <Show when={current().mission}>
                      {(mission) => (
                        <div class="mt-4 border-t border-white/10 pt-4">
                          <p class="font-mono text-sm font-bold text-white">{mission().title}</p>
                          <p class="mt-1 text-sm text-secondary-200/85">{mission().summary}</p>
                        </div>
                      )}
                    </Show>
                    <Show when={current().badges?.length}>
                      <ul class="mt-4 space-y-2" role="list">
                        <For each={current().badges}>
                          {(badge) => <li class="text-sm text-secondary-100"><span class="font-bold">Badge unlocked:</span> {badge.name}</li>}
                        </For>
                      </ul>
                    </Show>
                    <Show when={current().profile}>
                      {(profile) => (
                        <>
                          <p class="mt-4 font-mono text-xs uppercase tracking-[0.1em] text-primary-200">
                            <Show when={(current().xpAwarded || 0) > 0} fallback={
                              <Show when={current().status === "already_redeemed"} fallback={<>Progress saved. No extra XP under the current scoring limits.</>}>
                                Already redeemed. No extra XP added.
                              </Show>
                            }>
                              {current().xpAwarded} XP recorded.
                            </Show>{" "}Total: {profile().totalXp} XP / {profile().accessLevelLabel}
                          </p>
                          <Show when={profile().repairState === "rebuild_pending"}>
                            <p class="mt-3 rounded-lg border border-warning-400/25 bg-warning-500/10 p-3 text-xs text-warning-100">
                              Your progress is saved, but totals need repair. Support reference: <span class="font-mono">{profile().supportReference}</span>.
                            </p>
                          </Show>
                        </>
                      )}
                    </Show>
                    <Show when={current().partnerFollowUp?.state !== "granted" ? current().partnerFollowUp : undefined}>
                      {(consent) => (
                        <form class="mt-5 border-t border-white/15 pt-4" onSubmit={(event) => void grantPartnerFollowUp(event, consent().activityId)} aria-busy={consentBusy() ? "true" : "false"}>
                          <fieldset>
                            <legend class="font-mono text-xs font-bold uppercase tracking-[0.1em] text-primary-200">Optional partner follow-up</legend>
                            <p class="mt-2 text-sm leading-relaxed text-secondary-100">
                              WhatTheStack may share your current name and email once with {consent().partner.name} for follow-up about {consent().activityLabel}. Notice: {consent().noticeVersion}.
                            </p>
                            <p class="mt-2 text-xs leading-relaxed text-secondary-200/85">Consent does not affect mission progress, badges, or XP. Withdraw in your profile before sharing; withdrawal cannot undo a completed handoff.</p>
                             <label class="mt-3 flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-secondary-100" for={`partner-follow-up-${consent().activityId}`}>
                              <input id={`partner-follow-up-${consent().activityId}`} name="partner-follow-up" type="checkbox" class="checkbox checkbox-primary mt-0.5 shrink-0" />
                              <span>I agree to this optional contact sharing.</span>
                            </label>
                            <button type="submit" class={`btn btn-outline btn-primary btn-sm mt-4 font-mono ${consentBusy() ? "loading" : ""}`} disabled={consentBusy()}>
                              {consentBusy() ? "Saving…" : "Allow follow-up"}
                            </button>
                          </fieldset>
                        </form>
                      )}
                    </Show>
                    <Show when={consentMessage()}>
                      <p class="mt-3 text-xs leading-relaxed text-secondary-100" role={consentMessageKind() === "error" ? "alert" : "status"}>{consentMessage()}</p>
                    </Show>
                    <Show when={current().supportMessage}>
                      <p class="mt-4 border-t border-white/10 pt-4 text-xs leading-relaxed text-secondary-200/80">{current().supportMessage}</p>
                    </Show>
                    <Show when={current().supportReference}>
                      <p class="mt-2 font-mono text-xs text-secondary-100">Support reference: {current().supportReference}</p>
                    </Show>
                    <Show when={!challenge() && (["rate_limited", "unavailable", "questions_incorrect", "questions_incomplete", "questions_malformed", "question_conflict"].includes(current().status))}>
                      <button type="button" class="btn btn-outline btn-warning mt-4 min-h-12 font-mono" disabled={isRedeeming() || retrySeconds() > 0} onClick={() => void submitCode(code() || pendingCode() || "", "manual")}>
                        {retrySeconds() > 0 ? `Retry in ${retrySeconds()}s` : current().status.startsWith("questions_") ? "Start a new attempt" : "Try again"}
                      </button>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <Show when={!challenge() && !isRedeeming()}>
          <Show when={scanFlow() && (result() || requestError())}><button type="button" class="link link-primary mt-4 block min-h-12 py-3 text-sm" onClick={() => setScanFlow(false)}>Enter a different code</button></Show>
          <Show when={result()?.status === "accepted" || result()?.status === "already_redeemed"}><a href="/user/profile#gamification" class="link link-primary mt-4 inline-block min-h-12 py-3 text-sm">View achievements</a></Show>
          <details class="mt-2 border-t border-white/10 pt-2 text-xs leading-relaxed text-secondary-300/75">
            <summary class="link link-primary cursor-pointer min-h-12 py-3 text-sm">How it works</summary>
            <p class="pb-3">Your scanned code stays only in this tab while you sign in.</p>
            <p class="pb-3">Scan a WTS mission link or enter its code. For help, contact event support with your signed-in profile. Support will not ask you to share a code online.</p>
          </details>
          </Show>
        </section>
      </div>
    </Layout>
  );
};

export default clientOnly(async () => ({ default: RedeemMissionPage }), { lazy: true });

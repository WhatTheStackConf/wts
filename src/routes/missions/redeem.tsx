import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import type { MissionCodeRedemptionResult } from "~/lib/mission-code-redemption";
import { redeemMissionCode } from "~/lib/mission-code-redemption-action";
import { grantMyPartnerContactConsent } from "~/lib/partner-contact-consent-actions";
import {
  clearPendingMissionCode,
  missionCodeFromFragment,
  readPendingMissionCode,
  savePendingMissionCode,
  setMissionCodeLoginResume,
} from "~/lib/mission-code-resume";
import pb from "~/lib/pocketbase";
import { syncCookieFromToken } from "~/lib/server-auth";

const RedeemMissionPage = () => {
  const auth = useAuth();
  const [code, setCode] = createSignal("");
  const [pendingVersion, setPendingVersion] = createSignal(0);
  const [isRedeeming, setIsRedeeming] = createSignal(false);
  const [result, setResult] = createSignal<MissionCodeRedemptionResult>();
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

  const submitCode = async (rawCode: string, sourceHint: "link" | "manual") => {
    if (isRedeeming()) return;
    const trimmedCode = rawCode.trim();
    if (!trimmedCode) {
      setRequestError("Enter a Mission code to continue.");
      return;
    }
    if (!auth.isAuthenticated()) {
      redirectToLogin(trimmedCode);
      return;
    }

    setIsRedeeming(true);
    setRequestError("");
    setResult(undefined);
    try {
      if (pb.authStore.token) await syncCookieFromToken(pb.authStore.token);
      const redemption = await redeemMissionCode(trimmedCode, sourceHint);
      setResult(redemption);
      if (redemption.status !== "rate_limited" && redemption.status !== "unavailable") {
        clearPendingMissionCode(window.sessionStorage);
        setPendingVersion((value) => value + 1);
      }
      if (redemption.status === "accepted") setCode("");
    } catch {
      // Retain the secret only in this tab so a temporary outage cannot lose a valid scan.
      savePendingMissionCode(window.sessionStorage, trimmedCode);
      setPendingVersion((value) => value + 1);
      setRequestError("We could not reach Mission redemption. Check your connection and try again.");
    } finally {
      setIsRedeeming(false);
    }
  };

  const resumePendingCode = () => {
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
    void submitCode(code(), "manual");
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
      if (pb.authStore.token) await syncCookieFromToken(pb.authStore.token);
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
    if (fragmentCode) {
      savePendingMissionCode(window.sessionStorage, fragmentCode);
      setPendingVersion((value) => value + 1);
    }
    if (window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    resumePendingCode();
  };

  onMount(() => {
    captureFragmentCode();
    window.addEventListener("hashchange", captureFragmentCode);
    onCleanup(() => window.removeEventListener("hashchange", captureFragmentCode));
  });

  createEffect(() => {
    auth.isLoading();
    auth.isAuthenticated();
    pendingVersion();
    resumePendingCode();
  });

  createEffect(() => {
    if (requestError()) queueMicrotask(() => requestErrorRegion?.focus());
    else if (result()) queueMicrotask(() => resultRegion?.focus());
  });

  return (
    <Layout title="Redeem Mission // WhatTheStack" description="Redeem a WhatTheStack Mission code.">
      <div class="min-h-screen px-4 pb-20 pt-24">
        <section class="mx-auto max-w-xl rounded-2xl border border-primary-500/25 bg-base-200/80 p-6 shadow-xl backdrop-blur-sm md:p-8" aria-labelledby="mission-redeem-heading">
          <p class="font-mono text-xs uppercase tracking-[0.14em] text-primary-300">Field progress</p>
          <h1 id="mission-redeem-heading" class="mt-2 text-3xl font-star text-white md:text-4xl">REDEEM MISSION</h1>
          <p class="mt-3 text-sm leading-relaxed text-secondary-200/85">
            Scan a WhatTheStack Mission link or enter its code below. Your completion is linked only to your signed-in profile.
          </p>

          <Show when={!auth.isLoading() && !auth.isAuthenticated()}>
            <div class="mt-6 rounded-xl border border-secondary-400/25 bg-secondary-500/10 p-4" role="status">
              <p class="text-sm text-secondary-100">Sign in before redeeming. A scanned code stays only in this browser tab while you log in.</p>
              <button type="button" class="btn btn-secondary btn-sm mt-3" onClick={() => redirectToLogin(code() || pendingCode() || "") } disabled={!code() && !pendingCode()}>
                Sign in to redeem
              </button>
            </div>
          </Show>

          <form class="mt-6 space-y-4" onSubmit={handleSubmit} aria-busy={isRedeeming()}>
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
                disabled={isRedeeming() || result()?.status === "rate_limited"}
                aria-describedby={requestError() ? "mission-code-help mission-code-error" : "mission-code-help"}
                aria-invalid={requestError() ? "true" : undefined}
              />
              <p id="mission-code-help" class="mt-2 text-xs leading-relaxed text-secondary-300/75">
                Codes are case-insensitive. Do not share a scanned code in messages or screenshots.
              </p>
            </div>

            <button type="submit" class="btn btn-primary w-full font-mono" disabled={isRedeeming() || result()?.status === "rate_limited"}>
              <Show when={!isRedeeming()} fallback={<><span class="loading loading-spinner loading-sm" aria-hidden="true" /> Recording Mission...</>}>
                Redeem Mission
              </Show>
            </button>
          </form>

          <Show when={requestError()}>
            <div ref={requestErrorRegion} id="mission-code-error" class="alert alert-error mt-5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error" role="alert" tabindex="-1">
              <Icon icon="material-symbols:error-outline" aria-hidden="true" />
              <span>{requestError()}</span>
            </div>
          </Show>

          <Show when={result()}>
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
                        <div class="mt-4 rounded-lg bg-base-300/35 p-4">
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
                              <Show when={current().status === "already_redeemed"} fallback={<>Evidence recorded with no additional XP under the current scoring limits.</>}>
                                No additional XP was added for this duplicate redemption.
                              </Show>
                            }>
                              {current().xpAwarded} XP recorded.
                            </Show>{" "}Total: {profile().totalXp} XP / {profile().accessLevelLabel}
                          </p>
                          <Show when={profile().repairState === "rebuild_pending"}>
                            <p class="mt-3 rounded-lg border border-warning-400/25 bg-warning-500/10 p-3 text-xs text-warning-100">
                              Your evidence is safe, but displayed totals are awaiting repair. Support reference: <span class="font-mono">{profile().supportReference}</span>.
                            </p>
                          </Show>
                        </>
                      )}
                    </Show>
                    <Show when={current().partnerFollowUp?.state !== "granted" ? current().partnerFollowUp : undefined}>
                      {(consent) => (
                        <form class="mt-5 rounded-lg border border-white/15 bg-base-300/35 p-4" onSubmit={(event) => void grantPartnerFollowUp(event, consent().activityId)} aria-busy={consentBusy()}>
                          <fieldset>
                            <legend class="font-mono text-xs font-bold uppercase tracking-[0.1em] text-primary-200">Optional partner follow-up</legend>
                            <p class="mt-2 text-sm leading-relaxed text-secondary-100">
                              If you opt in, WhatTheStack may make one future handoff to {consent().partner.name} for follow-up about {consent().activityLabel}. The handoff contains only your current name and email. Notice: {consent().noticeVersion}.
                            </p>
                             <label class="mt-3 flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-secondary-100" for={`partner-follow-up-${consent().activityId}`}>
                              <input id={`partner-follow-up-${consent().activityId}`} name="partner-follow-up" type="checkbox" class="checkbox checkbox-primary mt-0.5 shrink-0" />
                              <span>I agree to this separate partner_follow_up handoff.</span>
                            </label>
                            <button type="submit" class={`btn btn-outline btn-primary btn-sm mt-4 font-mono ${consentBusy() ? "loading" : ""}`} disabled={consentBusy()}>
                              Record separate consent
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
                    <Show when={current().status === "rate_limited" || current().status === "unavailable"}>
                      <button type="button" class="btn btn-outline btn-warning mt-4 min-h-12 font-mono" disabled={isRedeeming()} onClick={() => void submitCode(code() || pendingCode() || "", "manual")}>
                        Try redemption again
                      </button>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <p class="mt-6 text-center text-xs leading-relaxed text-secondary-300/70">
            Need help? Speak with WhatTheStack event support and identify your logged-in profile. Support will not ask you to share a code online.
          </p>
        </section>
      </div>
    </Layout>
  );
};

export default clientOnly(async () => ({ default: RedeemMissionPage }), { lazy: true });

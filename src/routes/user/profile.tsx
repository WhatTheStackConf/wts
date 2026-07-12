import { createEffect, createSignal, Show, createResource, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { clientOnly } from "@solidjs/start";
import pb from "~/lib/pocketbase";
import { Icon } from "@iconify-icon/solid";

import SparkMD5 from "spark-md5";
import { sanitizeHtml } from "~/lib/sanitize-html";
import { fetchProposals, loadSubmissionToStore, resetProposalData } from "~/lib/cfp-store";
import {
  getMyGamificationProfileSummary,
  updateMyGamificationBadgeVisibility,
  updateMyGamificationVisibility,
} from "~/lib/gamification-profile";
import {
  getMyPartnerContactConsentSummaries,
  grantMyPartnerContactConsent,
  withdrawMyPartnerContactConsent,
} from "~/lib/partner-contact-consent-actions";
import {
  getMyHiEventsEvidenceStatus,
  refreshMyHiEventsEvidence,
} from "~/lib/gamification-hievents-actions";
import { syncCookieFromToken } from "~/lib/server-auth";

const ProfilePage = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = createSignal<typeof pb.authStore.record | null>(
    pb.authStore.record,
  );
  const [isUpdating, setIsUpdating] = createSignal(false);
  const [imgError, setImgError] = createSignal(false);
  const [message, setMessage] = createSignal<{
    type: string;
    text: string;
  } | null>(null);

  const [proposals] = createResource(fetchProposals);
  const [gamification, { refetch: refetchGamification }] = createResource(
    () => auth.isAuthenticated(),
    async (authenticated) => {
      if (!authenticated) return undefined;
      if (pb.authStore.token) await syncCookieFromToken(pb.authStore.token);
      return getMyGamificationProfileSummary();
    },
  );
  const [opsBoardVisible, setOpsBoardVisible] = createSignal(true);
  const [opsBoardDisplayName, setOpsBoardDisplayName] = createSignal("");
  const [publicBadgesVisible, setPublicBadgesVisible] = createSignal(true);
  const [visibilityBusy, setVisibilityBusy] = createSignal(false);
  const [visibilityMessage, setVisibilityMessage] = createSignal("");
  const [visibilityMessageKind, setVisibilityMessageKind] = createSignal<"success" | "error">("success");
  createEffect(() => {
    const summary = gamification();
    if (!summary) return;
    setOpsBoardVisible(summary.opsBoard.visible);
    setOpsBoardDisplayName(summary.opsBoard.displayName);
    setPublicBadgesVisible(summary.opsBoard.publicBadgesVisible);
  });
  const [ticketRefreshRequest, setTicketRefreshRequest] = createSignal(0);
  const [consentBusy, setConsentBusy] = createSignal(false);
  const [consentMessage, setConsentMessage] = createSignal("");
  const [consentMessageKind, setConsentMessageKind] = createSignal<"success" | "error">("success");
  const [partnerConsents, { refetch: refetchPartnerConsents }] = createResource(
    () => auth.isAuthenticated(),
    async (authenticated) => {
      if (!authenticated) return [];
      if (pb.authStore.token) await syncCookieFromToken(pb.authStore.token);
      return getMyPartnerContactConsentSummaries();
    },
  );
  const [ticketStatus] = createResource(
    () => auth.isAuthenticated() ? ticketRefreshRequest() : undefined,
    async (request) => {
      if (pb.authStore.token) await syncCookieFromToken(pb.authStore.token);
      if (request > 0) {
        const status = await refreshMyHiEventsEvidence();
        await refetchGamification();
        return status;
      }
      const status = await getMyHiEventsEvidenceStatus();
      if (status.state !== "stale") return status;
      const refreshed = await refreshMyHiEventsEvidence();
      await refetchGamification();
      return refreshed;
    },
  );

  const handleEditProposal = (proposal: any) => {
    loadSubmissionToStore(proposal);
    navigate("/cfp/03-proposal");
  };

  // Redirect if not authenticated
  if (!auth || !auth.isAuthenticated()) {
    navigate("/login");
    return null;
  }

  const getGravatarUrl = (email: string) => {
    const trimmedEmail = email.trim().toLowerCase();
    const hash = SparkMD5.hash(trimmedEmail);
    // Use a larger size for the profile page
    return `https://www.gravatar.com/avatar/${hash}?s=200&d=404`;
  };

  const getInitials = () => {
    const name = user()?.name;
    const email = user()?.email;
    if (name) {
      return name.charAt(0).toUpperCase();
    }
    if (email) {
      return email.charAt(0).toUpperCase();
    }
    return "A"; // Agent
  };

  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const { name, value } = target;

    setUser((prev) => ({
      ...prev!,
      [name]: value,
    }));
  };

  const handleSave = async (event?: Event) => {
    event?.preventDefault();
    if (!user()) return;

    setIsUpdating(true);
    setMessage(null);

    try {
      // Update user profile in PocketBase
      const updatedUser = await pb.collection("users").update(user()!.id, {
        name: user()!.name,
        // email: user()!.email, // Email usually handled separately in PB
      });

      // Update auth store with new data
      pb.authStore.save(pb.authStore.token, updatedUser);

      setMessage({ type: "success", text: "Identity updated successfully." });
    } catch (error) {
      console.error("Error updating profile:", error);
      setMessage({
        type: "error",
        text: "Database connection failed. Please try again.",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLogout = () => {
    pb.authStore.clear();
    // Force reload/redirect to clear state properly
    window.location.href = "/";
  };

  const refreshTicketStatus = () => setTicketRefreshRequest((request) => request + 1);

  const saveGamificationVisibility = async (event: SubmitEvent) => {
    event.preventDefault();
    setVisibilityBusy(true);
    setVisibilityMessage("");
    try {
      if (pb.authStore.token) await syncCookieFromToken(pb.authStore.token);
      const summary = await updateMyGamificationVisibility({
        opsBoardVisible: opsBoardVisible(),
        opsBoardDisplayName: opsBoardDisplayName(),
        publicBadgesVisible: publicBadgesVisible(),
      });
      setOpsBoardVisible(summary.opsBoard.visible);
      setOpsBoardDisplayName(summary.opsBoard.displayName);
      setPublicBadgesVisible(summary.opsBoard.publicBadgesVisible);
      await refetchGamification();
      setVisibilityMessage("Ops-board visibility settings saved.");
      setVisibilityMessageKind("success");
    } catch (error) {
      setVisibilityMessage(error instanceof Error ? error.message : "Ops-board visibility settings could not be saved.");
      setVisibilityMessageKind("error");
    } finally {
      setVisibilityBusy(false);
    }
  };

  const saveBadgeVisibility = async (badgeId: string, publicVisible: boolean) => {
    setVisibilityBusy(true);
    setVisibilityMessage("");
    try {
      if (pb.authStore.token) await syncCookieFromToken(pb.authStore.token);
      await updateMyGamificationBadgeVisibility(badgeId, publicVisible);
      await refetchGamification();
      setVisibilityMessage("Badge snippet visibility saved.");
      setVisibilityMessageKind("success");
    } catch (error) {
      setVisibilityMessage(error instanceof Error ? error.message : "Badge snippet visibility could not be saved.");
      setVisibilityMessageKind("error");
    } finally {
      setVisibilityBusy(false);
    }
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
      await grantMyPartnerContactConsent(activityId);
      await refetchPartnerConsents();
      setConsentMessage("Partner follow-up consent recorded. You can withdraw it before any future WTS handoff.");
      setConsentMessageKind("success");
    } catch (error) {
      setConsentMessage(error instanceof Error ? error.message : "Partner follow-up consent could not be recorded.");
      setConsentMessageKind("error");
    } finally {
      setConsentBusy(false);
    }
  };

  const withdrawPartnerFollowUp = async (consentId: string) => {
    setConsentBusy(true);
    setConsentMessage("");
    try {
      if (pb.authStore.token) await syncCookieFromToken(pb.authStore.token);
      await withdrawMyPartnerContactConsent(consentId);
      await refetchPartnerConsents();
      setConsentMessage("Partner follow-up consent withdrawn. Existing gamification progress is unchanged.");
      setConsentMessageKind("success");
    } catch (error) {
      setConsentMessage(error instanceof Error ? error.message : "Partner follow-up consent could not be withdrawn.");
      setConsentMessageKind("error");
    } finally {
      setConsentBusy(false);
    }
  };

  return (
    <Layout
      title="Agent Profile // WhatTheStack"
      description="Manage your digital identity."
    >
      <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
        {/* Background Elements */}
        <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-primary-900/20 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
        <div class="absolute bottom-0 left-0 w-[500px] h-[500px] bg-secondary-900/20 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

        <div class="container mx-auto px-4">
          <div class="max-w-4xl mx-auto">
            {/* Header */}
            <div class="mb-8 text-center md:text-left">
              <div class="inline-block px-4 py-1 border border-primary-500/30 rounded-full bg-primary-500/10 backdrop-blur-sm mb-4">
                <span class="text-primary-300 font-mono text-sm tracking-widest uppercase">
                  ACCESS LEVEL: AUTHENTICATED
                </span>
              </div>
              <h1 class="text-4xl md:text-6xl font-star text-transparent bg-clip-text bg-gradient-to-r from-white via-primary-200 to-secondary-200">
                WTS PROFILE
              </h1>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Sidebar / Identity Card */}
              <div class="lg:col-span-1">
                <div class="glass-panel p-6 rounded-2xl border border-white/10 relative overflow-hidden group">
                  <div class="absolute inset-0 bg-gradient-to-b from-primary-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>

                  <div class="flex flex-col items-center text-center">
                    <div class="w-32 h-32 rounded-full border-2 border-primary-500/50 p-1 mb-6 relative shadow-[0_0_20px_rgba(var(--color-primary-500),0.3)]">
                      <div class="w-full h-full rounded-full bg-base-300 flex items-center justify-center overflow-hidden relative">
                        <Show
                          when={!imgError()}
                          fallback={
                            <span class="text-4xl font-mono text-primary-300 font-bold">
                              {getInitials()}
                            </span>
                          }
                        >
                          <img
                            src={getGravatarUrl(user()?.email || "")}
                            alt={`${user()?.name || "Agent"} profile avatar`}
                            class="w-full h-full object-cover"
                            onError={() => setImgError(true)}
                          />
                        </Show>

                        {/* Scan line effect */}
                        <div class="absolute inset-0 w-full h-[2px] bg-primary-400/50 animate-scan-fast opacity-50 pointer-events-none"></div>
                      </div>
                    </div>

                    <h2 class="max-w-full break-words text-xl font-bold text-white mb-1 font-mono">
                      {user()?.name || "Unknown Agent"}
                    </h2>
                    <p class="text-sm text-secondary-300 font-mono mb-6 truncate max-w-full px-2">
                      {user()?.email}
                    </p>

                    <div class="w-full h-px bg-white/10 mb-6"></div>

                    <button
                      onClick={handleLogout}
                      class="btn btn-outline btn-error w-full font-mono gap-2 hover:bg-error/10"
                    >
                      <Icon icon="material-symbols:logout" />
                      DISCONNECT
                    </button>
                  </div>
                </div>
              </div>

              {/* Main Content / Edit Form */}
              <div class="lg:col-span-2">
                <div class="glass-panel p-8 rounded-2xl border border-white/10 h-full">
                  <h3 class="text-2xl font-star text-secondary-300 mb-8 flex items-center gap-3">
                    <Icon icon="material-symbols:settings-account-box-outline" />
                    IDENTITY SETTINGS
                  </h3>

                  <Show when={message()}>
                    <div
                      class={`alert mb-6 ${message()?.type === "error" ? "alert-error bg-error/10 text-error border-error/20" : "alert-success bg-success/10 text-success border-success/20"}`}
                      role={message()?.type === "error" ? "alert" : "status"}
                    >
                      <Icon
                        icon={
                          message()?.type === "error"
                            ? "material-symbols:error-outline"
                            : "material-symbols:check-circle-outline"
                        }
                        class="text-xl"
                      />
                      <span>{message()?.text}</span>
                    </div>
                  </Show>

                  <form class="space-y-6" onSubmit={(event) => void handleSave(event)}>
                    <div class="form-control">
                      <label class="label" for="profile-name">
                        <span class="label-text font-mono text-primary-200">
                          CODENAME (FULL NAME)
                        </span>
                      </label>
                      <input
                        id="profile-name"
                        type="text"
                        name="name"
                        autocomplete="name"
                        value={user()?.name || ""}
                        onInput={handleInputChange}
                        class="input input-lg bg-base-300/50 border-white/10 focus:border-primary-500 focus:outline-none text-white font-mono placeholder:text-white/20"
                        placeholder="Enter your name"
                      />
                    </div>

                    <div class="form-control">
                      <label class="label" for="profile-email">
                        <span class="label-text font-mono text-primary-200">
                          COMMUNICATION LINK (EMAIL)
                        </span>
                      </label>
                      <input
                        id="profile-email"
                        type="email"
                        value={user()?.email || ""}
                        class="input input-lg bg-base-300/30 border-white/5 text-white/50 font-mono cursor-not-allowed"
                        disabled
                      />
                      <label class="label">
                        <span class="label-text-alt text-secondary-300/50">
                          {" "}
                          Immutable identifier. Contact command for changes.
                        </span>
                      </label>
                    </div>

                    <div class="pt-8 flex justify-end">
                      <button
                        type="submit"
                        disabled={isUpdating()}
                        class={`btn btn-primary btn-lg rounded-none font-star px-10 relative overflow-hidden group ${isUpdating() ? "loading" : ""}`}
                      >
                        <div class="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                        <span class="relative z-10">
                          {isUpdating() ? "UPLOADING..." : "SAVE CHANGES"}
                        </span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>

            <section id="gamification" class="mt-8 glass-panel overflow-hidden rounded-2xl border border-primary-500/20" aria-labelledby="gamification-heading">
              <header class="border-b border-primary-500/15 bg-primary-500/5 px-6 py-5 md:px-8">
                <p class="font-mono text-xs uppercase tracking-[0.14em] text-primary-300">Field progress</p>
                <h2 id="gamification-heading" class="mt-1 text-2xl font-star text-white">GAMIFICATION PROFILE</h2>
              </header>
              <Show
                when={!gamification.loading}
                fallback={
                  <div class="flex items-center gap-3 px-6 py-8 font-mono text-sm text-secondary-200/80 md:px-8">
                    <span class="loading loading-bars loading-md text-primary-400" aria-hidden="true" />
                    Loading field progress...
                  </div>
                }
              >
                <Show
                  when={gamification()}
                  fallback={
                    <p class="px-6 py-8 font-mono text-sm text-secondary-200/80 md:px-8" role="status">
                      Field progress is temporarily unavailable. Try refreshing your profile.
                    </p>
                  }
                >
                  {(summary) => (
                    <div class="space-y-7 p-6 md:p-8">
                      <Show when={summary().repair.state === "rebuild_pending"}>
                        <p class="rounded-xl border border-warning-400/30 bg-warning-500/10 p-4 text-sm text-warning-100" role="status">
                          Your field evidence is recorded, but displayed totals are awaiting repair. Contact event support with reference <span class="font-mono">{summary().repair.supportReference}</span>.
                        </p>
                      </Show>
                      <div class="rounded-xl border border-secondary-400/25 bg-secondary-500/10 p-5" aria-live="polite">
                        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p class="font-mono text-xs uppercase tracking-[0.12em] text-secondary-200">Conference ticket status</p>
                            <Show
                              when={!ticketStatus.loading && ticketStatus()}
                              fallback={<p class="mt-2 font-mono text-sm text-secondary-100/80">Checking conference progress...</p>}
                            >
                              {(status) => <>
                                <p class="mt-2 font-mono text-sm text-white">{status().message}</p>
                                <Show when={status().lastSuccessfulSyncAt}>
                                  <p class="mt-2 font-mono text-xs text-secondary-200/70">Last successful check: {new Date(status().lastSuccessfulSyncAt!).toLocaleString()}</p>
                                </Show>
                              </>}
                            </Show>
                          </div>
                          <button
                            type="button"
                            class={`btn btn-outline btn-secondary shrink-0 font-mono ${ticketStatus.loading ? "loading" : ""}`}
                            disabled={ticketStatus.loading}
                            onClick={refreshTicketStatus}
                          >
                            Refresh ticket status
                          </button>
                        </div>
                        <Show when={ticketStatus.error}>
                          <p class="mt-3 font-mono text-xs text-warning-200" role="alert">Ticket status is temporarily unavailable. Your existing progress is preserved.</p>
                        </Show>
                      </div>

                      <div class="grid gap-4 sm:grid-cols-2">
                        <div class="rounded-xl border border-primary-500/25 bg-primary-500/10 p-5">
                          <p class="font-mono text-xs uppercase tracking-[0.12em] text-primary-200">Total XP</p>
                          <p class="mt-2 text-4xl font-star text-white">{summary().totalXp}</p>
                        </div>
                        <div class="rounded-xl border border-secondary-400/25 bg-secondary-500/10 p-5">
                          <p class="font-mono text-xs uppercase tracking-[0.12em] text-secondary-200">Access level</p>
                          <p class="mt-2 text-2xl font-star text-white">{summary().accessLevelLabel}</p>
                        </div>
                      </div>

                      <section class="rounded-xl border border-primary-500/25 bg-primary-500/10 p-5" aria-labelledby="ops-board-visibility-heading">
                        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 id="ops-board-visibility-heading" class="font-mono text-sm font-bold uppercase tracking-[0.12em] text-primary-200">Ops-board visibility</h3>
                            <p class="mt-2 text-sm leading-relaxed text-secondary-200/80">
                              The public ops board uses Leaderboard XP, not your total XP. Your profile and progress remain private when you opt out.
                            </p>
                          </div>
                          <a href="/ops-board" class="btn btn-outline btn-primary btn-sm shrink-0 font-mono">View ops board</a>
                        </div>
                        <form class="mt-5 space-y-5" onSubmit={(event) => void saveGamificationVisibility(event)} aria-busy={visibilityBusy()}>
                          <fieldset disabled={visibilityBusy()}>
                            <legend class="sr-only">Public ops-board settings</legend>
                            <label class="flex min-h-12 cursor-pointer items-start gap-3 text-sm leading-relaxed text-secondary-100" for="ops-board-visible">
                              <input
                                id="ops-board-visible"
                                type="checkbox"
                                class="checkbox checkbox-primary mt-0.5 shrink-0"
                                checked={opsBoardVisible()}
                                onChange={(event) => setOpsBoardVisible(event.currentTarget.checked)}
                              />
                              <span><strong class="text-white">Show me on the public ops board</strong><br />Turning this off removes your public row and rank without changing your XP, Badges, or access level.</span>
                            </label>
                            <div class="mt-5 form-control">
                              <label class="label" for="ops-board-display-name">
                                <span class="label-text font-mono text-primary-200">PUBLIC OPS-BOARD DISPLAY NAME</span>
                              </label>
                              <input
                                id="ops-board-display-name"
                                type="text"
                                value={opsBoardDisplayName()}
                                onInput={(event) => setOpsBoardDisplayName(event.currentTarget.value)}
                                maxlength="80"
                                autocomplete="off"
                                aria-describedby="ops-board-display-name-help"
                                class="input input-lg min-h-12 bg-base-300/50 border-white/10 focus:border-primary-500 focus:outline-none text-white font-mono"
                              />
                              <p id="ops-board-display-name-help" class="mt-2 text-xs leading-relaxed text-secondary-300/75">Use up to 80 characters. Email addresses are never used as public display names.</p>
                            </div>
                            <label class="mt-5 flex min-h-12 cursor-pointer items-start gap-3 text-sm leading-relaxed text-secondary-100" for="ops-board-public-badges">
                              <input
                                id="ops-board-public-badges"
                                type="checkbox"
                                class="checkbox checkbox-primary mt-0.5 shrink-0"
                                checked={publicBadgesVisible()}
                                onChange={(event) => setPublicBadgesVisible(event.currentTarget.checked)}
                              />
                              <span><strong class="text-white">Show public Badge snippets</strong><br />This global setting hides all Badge snippets while leaving your ops-board row visible.</span>
                            </label>
                            <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <p class="font-mono text-xs text-secondary-200/80">Current Leaderboard XP: {summary().leaderboardXp}</p>
                              <button type="submit" class={`btn btn-primary min-h-12 font-mono ${visibilityBusy() ? "loading" : ""}`}>Save ops-board settings</button>
                            </div>
                          </fieldset>
                        </form>
                        <Show when={visibilityMessage()}>
                          <p class="mt-4 text-sm text-secondary-100" role={visibilityMessageKind() === "error" ? "alert" : "status"}>{visibilityMessage()}</p>
                        </Show>
                      </section>

                      <div>
                        <div class="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 class="font-mono text-sm font-bold uppercase tracking-[0.12em] text-primary-200">Progress to next level</h3>
                          <p class="font-mono text-xs text-secondary-200/80">
                            <Show
                              when={summary().progressAvailable && summary().xpToNextLevel > 0}
                              fallback={
                                <Show
                                  when={summary().progressAvailable}
                                  fallback={<>Access thresholds will appear when Missions are configured.</>}
                                >
                                  Maximum access level reached
                                </Show>
                              }
                            >
                              {summary().xpIntoLevel} XP in this level. {summary().xpToNextLevel} XP to go.
                            </Show>
                          </p>
                        </div>
                        <progress
                          class="progress progress-primary mt-3 h-3 w-full"
                          value={summary().progressPercent}
                          max="100"
                          aria-label="Progress to next access level"
                          aria-valuetext={`${summary().progressPercent}% progress to the next access level`}
                        />
                        <p class="mt-2 font-mono text-xs text-secondary-300/75">{summary().progressPercent}% complete</p>
                      </div>

                      <div>
                        <Show when={summary().badges.length > 0}>
                          <section class="mb-7" aria-labelledby="recent-badges-heading">
                            <h3 id="recent-badges-heading" class="font-mono text-sm font-bold uppercase tracking-[0.12em] text-primary-200">Recent Badges</h3>
                            <ul class="mt-3 grid gap-3 sm:grid-cols-3" role="list">
                              <For each={summary().badges.slice(0, 3)}>{(badge) => (
                                <li class="rounded-xl border border-primary-400/20 bg-primary-500/5 p-4">
                                  <p class="break-words font-mono text-sm font-bold text-white">{badge.name}</p>
                                  <p class="mt-2 font-mono text-xs uppercase tracking-[0.1em] text-secondary-300/75">Unlocked Badge<Show when={badge.retired}> / Retired</Show></p>
                                </li>
                              )}</For>
                            </ul>
                          </section>
                        </Show>
                        <div class="flex items-baseline justify-between gap-3">
                          <h3 class="font-mono text-sm font-bold uppercase tracking-[0.12em] text-primary-200">Unlocked Badges</h3>
                          <span class="font-mono text-xs text-secondary-300/75">{summary().badges.length} collected</span>
                        </div>
                        <Show
                          when={summary().badges.length > 0}
                          fallback={
                            <p class="mt-3 rounded-xl border border-dashed border-white/15 bg-base-300/20 p-5 font-mono text-sm text-secondary-200/75">
                              Your unlocked Badges will appear here as you complete Missions.
                            </p>
                          }
                        >
                          <ul class="mt-3 grid gap-3 sm:grid-cols-2" role="list">
                            <For each={summary().badges}>
                              {(badge) => (
                                <li class="rounded-xl border border-white/10 bg-base-300/35 p-4">
                                  <div class="flex items-start gap-3">
                                    <Icon icon={badge.icon || "material-symbols:military-tech-outline"} class="mt-0.5 text-xl text-primary-300" aria-hidden="true" />
                                    <div class="min-w-0">
                                      <p class="font-mono text-sm font-bold text-white">{badge.name}</p>
                                      <p class="mt-1 text-sm leading-relaxed text-secondary-200/80">{badge.description}</p>
                                       <p class="mt-2 font-mono text-xs uppercase tracking-[0.1em] text-secondary-300/75">
                                         {badge.category} / {badge.rarity} / unlocked<Show when={badge.retired}> / retired</Show>
                                       </p>
                                       <label class="mt-3 flex min-h-12 cursor-pointer items-center gap-3 text-xs leading-relaxed text-secondary-100" for={`badge-public-${badge.id}`}>
                                         <input
                                           id={`badge-public-${badge.id}`}
                                           type="checkbox"
                                           class="checkbox checkbox-primary checkbox-sm shrink-0"
                                           checked={badge.publicVisible}
                                           disabled={visibilityBusy()}
                                           onChange={(event) => void saveBadgeVisibility(badge.id, event.currentTarget.checked)}
                                         />
                                         <span>Show this Badge as a public snippet. <strong class="text-white">{badge.publicVisible ? "Public" : "Private"}</strong></span>
                                       </label>
                                     </div>
                                   </div>
                                 </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                        <Show when={summary().revokedBadgeCount > 0}>
                          <p class="mt-3 rounded-xl border border-warning-400/25 bg-warning-500/10 p-4 text-sm leading-relaxed text-warning-100">
                            {summary().revokedBadgeCount} Badge<Show when={summary().revokedBadgeCount !== 1}>s</Show> removed by event support. Removed Badges do not affect your public profile.
                          </p>
                        </Show>
                      </div>

                      <Show when={summary().lockedBadges.length > 0}>
                        <section aria-labelledby="locked-badges-heading">
                          <div class="flex items-baseline justify-between gap-3">
                            <h3 id="locked-badges-heading" class="font-mono text-sm font-bold uppercase tracking-[0.12em] text-primary-200">Locked Badges</h3>
                            <span class="font-mono text-xs text-secondary-300/75">{summary().lockedBadges.length} available</span>
                          </div>
                          <ul class="mt-3 grid gap-3 sm:grid-cols-2" role="list">
                            <For each={summary().lockedBadges}>{(badge) => (
                              <li class="rounded-xl border border-dashed border-white/15 bg-base-300/20 p-4">
                                <p class="font-mono text-sm font-bold text-white">{badge.name}</p>
                                <p class="mt-1 text-sm leading-relaxed text-secondary-200/80">{badge.teaser}</p>
                                <p class="mt-2 font-mono text-xs uppercase tracking-[0.1em] text-secondary-300/75">{badge.category} / {badge.rarity} / locked</p>
                              </li>
                            )}</For>
                          </ul>
                        </section>
                      </Show>

                      <Show when={summary().suggestedMissions.length > 0}>
                        <section class="rounded-xl border border-primary-400/20 bg-primary-500/5 p-5" aria-labelledby="suggested-missions-heading">
                          <h3 id="suggested-missions-heading" class="font-mono text-sm font-bold uppercase tracking-[0.12em] text-primary-200">Suggested Missions</h3>
                          <ul class="mt-3 space-y-3" role="list">
                            <For each={summary().suggestedMissions}>{(mission) => (
                              <li>
                                <p class="font-mono text-sm font-bold text-white">{mission.title}</p>
                                <p class="mt-1 text-sm leading-relaxed text-secondary-200/80">{mission.summary}</p>
                                <a class="link link-primary mt-2 inline-block min-h-12 py-3 font-mono text-sm" href={mission.redemptionPath}>Redeem Mission code</a>
                              </li>
                            )}</For>
                          </ul>
                        </section>
                      </Show>

                      <Show when={!partnerConsents.loading && partnerConsents()?.length}>
                        <section class="rounded-xl border border-white/10 bg-base-300/25 p-5" aria-labelledby="partner-follow-up-heading">
                          <h3 id="partner-follow-up-heading" class="font-mono text-sm font-bold uppercase tracking-[0.12em] text-primary-200">Partner follow-up</h3>
                          <p class="mt-2 text-sm leading-relaxed text-secondary-200/80">This is optional and separate from Mission progress. It never changes a Claim, Badge, total XP, or Leaderboard XP.</p>
                           <Show when={consentMessage()}><p class="mt-3 text-xs leading-relaxed text-secondary-100" role={consentMessageKind() === "error" ? "alert" : "status"}>{consentMessage()}</p></Show>
                          <ul class="mt-4 space-y-4" role="list">
                            <For each={partnerConsents()}>
                              {(consent) => (
                                <li class="rounded-lg border border-white/10 bg-base-300/35 p-4">
                                  <p class="font-mono text-sm font-bold text-white">{consent.partner.name}</p>
                                   <p class="mt-1 text-sm text-secondary-200/85">Activity: {consent.activityLabel}</p>
                                  <p class="mt-1 text-xs leading-relaxed text-secondary-300/80">Purpose: {consent.purpose}. Notice: {consent.noticeVersion}. Fields: {consent.fields.join(" and ")}.</p>
                                  <Show when={consent.state === "granted"} fallback={
                                    <form class="mt-4" onSubmit={(event) => void grantPartnerFollowUp(event, consent.activityId)} aria-busy={consentBusy()}>
                                      <fieldset>
                                         <label class="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-secondary-100" for={`profile-partner-follow-up-${consent.activityId}`}>
                                          <input id={`profile-partner-follow-up-${consent.activityId}`} name="partner-follow-up" type="checkbox" class="checkbox checkbox-primary mt-0.5 shrink-0" />
                                          <span>I agree that WhatTheStack may make one future handoff of my current name and email to {consent.partner.name} for follow-up about this Activity.</span>
                                        </label>
                                        <button type="submit" class={`btn btn-outline btn-primary btn-sm mt-4 font-mono ${consentBusy() ? "loading" : ""}`} disabled={consentBusy()}>Record separate consent</button>
                                      </fieldset>
                                    </form>
                                  }>
                                    <div class="mt-4">
                                      <p class="text-sm text-success">Consent granted {consent.grantedAt ? new Date(consent.grantedAt).toLocaleString() : ""}. {consent.handoffState === "handed_off" ? "A one-time WTS handoff was already logged." : "No handoff has been logged."}</p>
                                      <button type="button" class="btn btn-outline btn-warning btn-sm mt-3 font-mono" disabled={consentBusy()} onClick={() => consent.consentId && void withdrawPartnerFollowUp(consent.consentId)}>Withdraw consent</button>
                                    </div>
                                  </Show>
                                  <Show when={consent.state === "withdrawn"}>
                                    <p class="mt-3 text-sm text-warning-200">Withdrawn {consent.withdrawnAt ? new Date(consent.withdrawnAt).toLocaleString() : ""}. Future WTS handoffs are blocked; Mission progress is unchanged.</p>
                                  </Show>
                                </li>
                              )}
                            </For>
                          </ul>
                        </section>
                      </Show>
                    </div>
                  )}
                </Show>
              </Show>
            </section>

            {/* CFP Submissions Section */}
            <div class="mt-8">
              <div class="glass-panel p-8 rounded-2xl border border-white/10 relative overflow-hidden">
                <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                  <Icon icon="material-symbols:mic-external-on" width="120" />
                </div>
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                  <h3 class="text-2xl font-star text-white">MY PROPOSALS</h3>
                  <button
                    onClick={() => {
                      resetProposalData();
                      navigate("/cfp/01-intro");
                    }}
                    class="btn btn-primary btn-sm font-mono gap-2"
                  >
                    <Icon icon="material-symbols:add" />
                    SUBMIT TALK
                  </button>
                </div>

                <Show when={proposals.loading}>
                  <div class="flex justify-center py-8">
                    <span class="loading loading-bars loading-lg text-primary"></span>
                  </div>
                </Show>

                <Show when={!proposals.loading && proposals()?.length === 0}>
                  <div class="p-6 border border-dashed border-white/20 rounded-xl bg-base-300/20 text-center">
                    <p class="text-secondary-300 font-mono mb-4">
                      NO SUBMISSIONS FOUND
                    </p>
                    <p class="text-sm text-secondary-300/60 font-mono mb-6">
                      Join the stage at WhatTheStack!
                    </p>
                  </div>
                </Show>

                <div class="space-y-4">
                  <For each={proposals()}>
                    {(proposal) => (
                      <div class="p-6 bg-base-300/30 border border-white/5 rounded-xl hover:border-primary-500/50 transition-colors group relative">
                        <div class="flex flex-col md:flex-row justify-between gap-4">
                          <div class="flex-grow">
                            <div class="flex items-center gap-3 mb-2">
                              <span class={`badge font-mono text-xs ${proposal.status === 'Accepted' ? 'badge-success' : 'badge-neutral badge-outline'}`}>
                                {proposal.status || "RECEIVED"}
                              </span>
                              <span class="text-xs font-mono text-white/30">
                                {new Date(proposal.created).toLocaleDateString()}
                              </span>
                            </div>
                            <h4 class="text-xl font-bold text-white mb-2 group-hover:text-primary-300 transition-colors">
                              {proposal.session_title || proposal.talk_title}
                            </h4>
                            <div class="line-clamp-2 text-sm text-secondary-300/80 font-mono mb-4">
                              <div innerHTML={sanitizeHtml(proposal.abstract)} />
                            </div>
                          </div>
                          <div class="flex items-start">
                            <button
                              onClick={() => handleEditProposal(proposal)}
                              class="btn btn-outline btn-sm font-mono gap-2 hover:bg-primary-500 hover:text-white"
                            >
                              <Icon icon="material-symbols:edit-square-outline" />
                              EDIT
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default clientOnly(async () => ({ default: ProfilePage }), {
  lazy: true,
});

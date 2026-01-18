import { createSignal, onMount, Show, createResource, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { clientOnly } from "@solidjs/start";
import pb from "~/lib/pocketbase";
import { Icon } from "@iconify-icon/solid";

import SparkMD5 from "spark-md5";
import { fetchProposals, loadSubmissionToStore, resetProposalData } from "~/lib/cfp-store";
import { fetchHiEventsAttendees } from "~/lib/hievents";

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
  const [tickets] = createResource(() => user()?.email, fetchHiEventsAttendees);

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

  const handleSave = async () => {
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
                            alt="Agent Avatar"
                            class="w-full h-full object-cover"
                            onError={() => setImgError(true)}
                          />
                        </Show>

                        {/* Scan line effect */}
                        <div class="absolute inset-0 w-full h-[2px] bg-primary-400/50 animate-scan-fast opacity-50 pointer-events-none"></div>
                      </div>
                    </div>

                    <h2 class="text-xl font-bold text-white mb-1 font-mono">
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

                  <div class="space-y-6">
                    <div class="form-control">
                      <label class="label">
                        <span class="label-text font-mono text-primary-200">
                          CODENAME (FULL NAME)
                        </span>
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={user()?.name || ""}
                        onInput={handleInputChange}
                        class="input input-lg bg-base-300/50 border-white/10 focus:border-primary-500 focus:outline-none text-white font-mono placeholder:text-white/20"
                        placeholder="Enter your name"
                      />
                    </div>

                    <div class="form-control">
                      <label class="label">
                        <span class="label-text font-mono text-primary-200">
                          COMMUNICATION LINK (EMAIL)
                        </span>
                      </label>
                      <input
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
                        onClick={handleSave}
                        disabled={isUpdating()}
                        class={`btn btn-primary btn-lg rounded-none font-star px-10 relative overflow-hidden group ${isUpdating() ? "loading" : ""}`}
                      >
                        <div class="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                        <span class="relative z-10">
                          {isUpdating() ? "UPLOADING..." : "SAVE CHANGES"}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ticket Section Mockup */}
            <div class="mt-8">
              {/* Tickets Section */}
              <div class="mt-8">
                <div class="glass-panel p-8 rounded-2xl border border-white/10 relative overflow-hidden">
                  <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                    <Icon icon="game-icons:ticket" width="120" />
                  </div>
                  <h3 class="text-2xl font-star text-white mb-6">MY TICKETS</h3>

                  <Show when={tickets.loading}>
                    <div class="flex justify-center py-8">
                      <span class="loading loading-bars loading-lg text-secondary"></span>
                    </div>
                  </Show>

                  <Show when={!tickets.loading && tickets()?.length === 0}>
                    <div class="p-6 border border-dashed border-white/20 rounded-xl bg-base-300/20 text-center">
                      <p class="text-secondary-300 font-mono mb-4">
                        NO ACTIVE TICKETS FOUND FOR {user()?.email?.toUpperCase()}
                      </p>
                      <a
                        href="/tickets"
                        class="btn btn-outline btn-secondary font-mono"
                      >
                        GET TICKETS
                      </a>
                    </div>
                  </Show>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <For each={tickets()}>
                      {(attendee) => (
                        <div class="p-6 bg-base-300/30 border border-white/5 rounded-xl hover:border-secondary-500/50 transition-colors group relative overflow-hidden">
                          {/* Decorative side bar */}
                          <div class="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-secondary-400 to-primary-500"></div>

                          <div class="flex justify-between items-start mb-4">
                            <div>
                              <h4 class="text-lg font-bold text-white mb-1 group-hover:text-secondary-300 transition-colors">
                                {attendee.ticket.title}
                              </h4>
                              <div class="text-xs font-mono text-white/50 bg-white/5 rounded px-2 py-1 inline-block">
                                ID: {attendee.id.substring(0, 8)}...
                              </div>
                            </div>
                            <Show when={attendee.public_url}>
                              <a
                                href={attendee.public_url}
                                target="_blank"
                                class="btn btn-xs btn-outline btn-secondary font-mono"
                              >
                                VIEW
                              </a>
                            </Show>
                          </div>

                          <div class="space-y-2 text-sm font-mono text-secondary-300/80">
                            <div class="flex justify-between">
                              <span>STATUS:</span>
                              <span class={attendee.checked_in_at ? "text-success" : "text-warning"}>
                                {attendee.checked_in_at ? "CHECKED IN" : "CONFIRMED"}
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span>PRICE:</span>
                              <span>{attendee.ticket.price} {attendee.ticket.currency}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </div>

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
                              <div innerHTML={proposal.abstract} />
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

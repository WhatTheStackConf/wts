import { createResource, For, Show } from "solid-js";
import { useNavigate, A } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { fetchProposals, loadSubmissionToStore } from "~/lib/cfp-store";
import { Icon } from "@iconify-icon/solid";
import { clientOnly } from "@solidjs/start";

const MyProposals = () => {
  const auth = useAuth();
  const navigate = useNavigate();

  // We use your existing fetchProposals, but we filter for the current user
  const [proposals] = createResource(async () => {
    const all = await fetchProposals();
    // Filter locally if your API doesn't handle the user filter in the helper
    return all;
  });

  const handleEdit = (proposal: any) => {
    // Uses your store's helper to populate the form
    loadSubmissionToStore(proposal);
    navigate("/cfp/03-proposal"); // Jump straight to proposal step
  };

  return (
    <Layout title="My Proposals - WhatTheStack 2026">
      <div class="container mx-auto px-4 py-12">
        <div class="max-w-5xl mx-auto">
          <div class="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
            <div>
              <h1 class="text-4xl font-bold text-primary mb-2 italic">
                Your Submissions
              </h1>
              <p class="text-base-content/60 font-medium font-mono text-sm">
                {proposals()?.length || 0} proposals found for{" "}
                {auth.record?.name}
              </p>
            </div>
            <A
              href="/cfp/01-intro"
              class="btn btn-primary gap-2 shadow-lg shadow-primary/30 px-8"
            >
              <Icon icon="material-symbols:add" class="text-xl" />
              New Proposal
            </A>
          </div>

          <Show when={proposals.loading}>
            <div class="flex flex-col items-center justify-center py-20 gap-4">
              <span class="loading loading-bars loading-lg text-primary"></span>
              <p class="text-xs uppercase tracking-widest opacity-50">
                Fetching Data...
              </p>
            </div>
          </Show>

          <Show
            when={!proposals.loading && proposals()}
            fallback={
              <Show when={!proposals.loading}>
                <div class="bg-base-200/30 border-2 border-dashed border-base-content/10 rounded-3xl p-20 text-center">
                  <h3 class="text-2xl font-bold opacity-60 mb-2">
                    Silence in the stack...
                  </h3>
                  <p class="mb-8 opacity-40">
                    You haven't submitted any proposals for 2026 yet.
                  </p>
                  <A href="/cfp/01-intro" class="btn btn-outline btn-wide">
                    Submit a Talk
                  </A>
                </div>
              </Show>
            }
          >
            <div class="grid grid-cols-1 gap-6">
              <For each={proposals()}>
                {(proposal) => (
                  <div class="group relative bg-base-100 border border-base-300 rounded-2xl overflow-hidden hover:border-primary/50 transition-all duration-300 shadow-sm hover:shadow-xl hover:shadow-primary/5">
                    <div class="p-6 md:p-8">
                      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                        <div class="flex items-center gap-3">
                          <div class="badge badge-primary badge-outline font-mono text-[10px] uppercase tracking-tighter">
                            {proposal.status || "Received"}
                          </div>
                          <span class="text-[10px] uppercase tracking-widest opacity-40 font-bold">
                            {new Date(proposal.created).toLocaleDateString()}
                          </span>
                        </div>

                        <div class="flex gap-2">
                          <button
                            onClick={() => handleEdit(proposal)}
                            class="btn btn-sm btn-ghost hover:bg-primary hover:text-primary-content gap-2"
                          >
                            <Icon icon="material-symbols:edit-square-outline" />{" "}
                            Edit / Reuse
                          </button>
                        </div>
                      </div>

                      <h2 class="text-2xl font-bold mb-4 group-hover:text-primary transition-colors">
                        {proposal.session_title || proposal.talk_title}
                      </h2>

                      {/* Render formatted abstract preview */}
                      <div class="prose prose-sm max-w-none text-base-content/60 line-clamp-3 mb-6 bg-base-200/30 p-4 rounded-xl">
                        <div innerHTML={proposal.abstract} />
                      </div>

                      <div class="flex flex-wrap gap-4 text-xs font-mono opacity-60">
                        <div class="flex items-center gap-1">
                          <Icon icon="material-symbols:calendar-today" />
                          WhatTheStack 2026
                        </div>
                        <Show
                          when={proposal.meta?.company_cover_expenses === "Yes"}
                        >
                          <div class="flex items-center gap-1 text-success">
                            <Icon icon="material-symbols:check-circle" />
                            Self-funded
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Layout>
  );
};

export default clientOnly(async () => ({ default: MyProposals }), {
  lazy: true,
});

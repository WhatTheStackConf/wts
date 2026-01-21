import { Show, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
// import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { useCfpStore, submitProposal } from "~/lib/cfp-store";
import { isCfpOpen } from "~/lib/cfp-utils";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";

import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

const Confirmation = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [errors, setErrors] = createSignal<string[]>([]);
  const [cfpStore] = useCfpStore();

  if (!auth || !auth.record) {
    if (typeof window !== "undefined") {
      localStorage.setItem("redirect_url", location.pathname);
    }
    navigate("/login");
  }
  if (!isCfpOpen()) {
    navigate("/");
  }

  const handleSubmit = async () => {
    setErrors([]);
    try {
      await submitProposal();
      // Show the modal
      (document.getElementById("confirmation_modal") as HTMLDialogElement).showModal();
    } catch (error: any) {
      console.error("Submission Error:", error);

      const errorMessages: string[] = [];

      // Handle PocketBase ClientResponseError
      if (error.response?.data) {
        const data = error.response.data;
        Object.keys(data).forEach((key) => {
          const fieldError = data[key];
          if (fieldError?.message) {
            errorMessages.push(`Field '${key}': ${fieldError.message}`);
          }
        });
      }

      if (errorMessages.length === 0) {
        errorMessages.push(error.message || "Submission failed. Please try again.");
      }

      setErrors(errorMessages);
    }
  };

  const handleModalClose = () => {
    // Navigate to the start of the CFP to allow another submission
    // The store is already reset by submitProposal
    navigate("/cfp/01-intro");
  };

  const SummarySection = (props: {
    title: string;
    step: number;
    children: any;
  }) => (
    <div class="border border-white/10 rounded-xl overflow-hidden mb-6 bg-base-300/10">
      <div class="bg-base-200/30 px-4 py-3 flex justify-between items-center border-b border-white/10">
        <h3 class="font-bold text-lg font-star text-white tracking-wide">{props.title}</h3>
        <button
          onClick={() => {
            const routes = ["", "01-intro", "02-personal", "03-proposal", "04-experience", "05-expenses"];
            navigate(`/cfp/${routes[props.step]}`);
          }}
          class="btn btn-ghost btn-sm gap-2 text-primary font-mono hover:bg-primary/10"
        >
          <Icon icon="material-symbols:edit-outline" /> EDIT
        </button>
      </div>
      <div class="p-4 space-y-3">{props.children}</div>
    </div>
  );



  return (
    <CfpStepLayout
      title="Confirm Submission - WhatTheStack 2026"
      description="Step 6: Confirm Submission"
      step={6}
    >
      {/* Modal */}
      <dialog id="confirmation_modal" class="modal">
        <div class="modal-box glass-panel border border-white/10">
          <h3 class="font-bold text-2xl font-star text-primary">
            {cfpStore.formData.id ? "EDITS SAVED!" : "PROPOSAL RECEIVED!"}
          </h3>
          <p class="py-4 font-mono text-sm leading-relaxed">
            {cfpStore.formData.id
              ? "Your changes have been successfully updated. You can continue to edit your proposal until the CFP closes."
              : "Thanks for throwing your hat in the ring! We've sent a confirmation email to your inbox."}
            <br /><br />
            Do you want to submit another talk?
          </p>
          <div class="modal-action">
            <form method="dialog">
              <button
                class="btn btn-primary font-mono"
                onClick={handleModalClose}
              >
                SUBMIT ANOTHER / RETURN
              </button>
            </form>
          </div>
        </div>
      </dialog>

      <h2 class="text-2xl font-bold font-star text-white mb-2 pt-4 flex items-center justify-center gap-3">
        <span class="text-primary">//</span> FINAL REVIEW
      </h2>
      <p class="text-center text-secondary-300 mb-8 font-mono text-sm">
        Check everything one last time. Our review process is anonymized.
      </p>

      <Show when={errors().length > 0}>
        <div class="mb-8 p-4 bg-error/10 border border-error/20 rounded-xl">
          <h3 class="text-error font-bold font-mono mb-2 flex items-center gap-2">
            <Icon icon="material-symbols:error-outline" />
            Submission Failed
          </h3>
          <ul class="list-disc list-inside text-sm text-error/80 font-mono">
            {errors().map((err) => (
              <li>{err}</li>
            ))}
          </ul>
        </div>
      </Show>
      <div class="grid grid-cols-1 gap-4">
        <SummarySection title="SPEAKER INFO" step={2}>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-y-2 text-sm font-mono text-secondary-300">
            <p>
              <span class="opacity-60 text-white">Name:</span>{" "}
              {cfpStore.formData.full_name}
            </p>
            <p>
              <span class="opacity-60 text-white">Email:</span>{" "}
              {cfpStore.formData.email}
            </p>
            <p class="md:col-span-2">
              <span class="opacity-60 text-white">Bio:</span>{" "}
              {cfpStore.formData.short_bio}
            </p>
          </div>
        </SummarySection>

        <SummarySection title="TALK PROPOSAL" step={3}>
          <p class="text-xl font-bold text-white mb-4">
            {cfpStore.formData.talk_title}
          </p>
          <div class="bg-base-300/30 p-4 rounded-lg border border-white/5 mb-4">
            <p class="font-mono text-xs uppercase text-primary mb-2">
              Abstract
            </p>
            <div
              class="prose prose-invert prose-sm max-w-none text-secondary-300"
              innerHTML={cfpStore.formData.abstract}
            />
          </div>
          <div class="bg-base-300/30 p-4 rounded-lg border border-white/5">
            <p class="font-mono text-xs uppercase text-primary mb-2">
              Takeaways
            </p>
            <div
              class="prose prose-invert prose-sm max-w-none text-secondary-300"
              innerHTML={cfpStore.formData.key_takeaways}
            />
          </div>
        </SummarySection>

        <SummarySection title="LOGISTICS" step={5}>
          <div class="flex items-center gap-3">
            <div
              class={`badge badge-lg font-mono ${cfpStore.formData.company_cover_expenses === "Yes"
                ? "badge-success text-base-100"
                : "badge-warning text-base-100"
                }`}
            >
              Company covers travel: {cfpStore.formData.company_cover_expenses}
            </div>
          </div>
          <Show when={cfpStore.formData.additional_info}>
            <div class="mt-4 p-4 bg-base-300/30 rounded-lg border border-white/5">
              <p class="font-mono text-xs uppercase text-primary mb-1">
                Additional Notes
              </p>
              <p class="text-sm text-secondary-300 font-mono">
                {cfpStore.formData.additional_info}
              </p>
            </div>
          </Show>
        </SummarySection>
      </div>

      <div class="alert bg-primary/10 border-primary/20 mt-8 rounded-xl shadow-lg">
        <Icon
          icon="material-symbols:info-outline"
          class="text-primary text-2xl"
        />
        <span class="text-sm font-mono text-primary-content/80">
          Once submitted, you'll still be able to edit the proposal details.
          Personal profile changes will still sync as described in{" "}
          <a class="link link-primary font-bold" href="/cfp/step-2">
            Step 2.
          </a>
        </span>
      </div>

      <div class="flex flex-col md:flex-row justify-between mt-10 gap-4">
        <button
          onClick={() => navigate("/cfp/05-expenses")}
          class="btn btn-outline btn-lg flex-1 font-mono hover:bg-white/10"
        >
          BACK
        </button>
        <button
          onClick={handleSubmit}
          class="btn btn-primary btn-lg flex-[2] gap-2 shadow-[0_0_20px_rgba(var(--color-primary-500),0.4)] font-mono border-primary"
        >
          {cfpStore.formData.id ? "SAVE PROPOSAL EDITS" : "SUBMIT PROPOSAL"}
          <Icon
            icon={
              cfpStore.formData.id
                ? "material-symbols:save-as-outline"
                : "material-symbols:rocket-launch"
            }
          />
        </button>
      </div>
    </CfpStepLayout >
  );
};

export default clientOnly(async () => ({ default: Confirmation }), {
  lazy: true,
});

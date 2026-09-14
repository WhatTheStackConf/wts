import { Show, createSignal } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { useNavigate } from "@solidjs/router";
// import { Layout } from "~/layouts/Layout";
import { useRequireAuth } from "~/lib/route-guards";
import { useCfpStore, submitProposal } from "~/lib/cfp-store";
import { isCfpOpen, fetchCfpConfig } from "~/lib/cfp-utils";
import { clientOnly } from "@solidjs/web";
import { Icon } from "~/components/Icon";

import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

const Confirmation = () => {
  useRequireAuth();
  const navigate = useNavigate();
  const [errors, setErrors] = createSignal<string[]>([]);
  const [cfpStore] = useCfpStore();
  const [cfpConfig] = createResource(fetchCfpConfig);

  if (!isCfpOpen()) {
    navigate("/cfp/closed");
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
    <section class="border-t border-white/10 pt-4 mb-6 min-w-0">
      <div class="flex justify-between items-center gap-3 mb-3">
        <h2 class="font-bold text-lg text-white">{props.title}</h2>
        <button
          onClick={() => {
            const routes = ["", "01-intro", "02-personal", "03-proposal", "04-experience", "05-expenses"];
            navigate(`/cfp/${routes[props.step]}`);
          }}
          aria-label={`Edit ${props.title.toLowerCase()}`}
          class="btn btn-ghost btn-sm gap-2 text-primary hover:bg-primary/10"
        >
          <Icon icon="material-symbols:edit-outline" /> Edit
        </button>
      </div>
      <div class="space-y-3 break-words">{props.children}</div>
    </section>
  );



  return (
    <CfpStepLayout
      title="Review your proposal"
      description="Step 6: Confirm Submission"
      step={6}
    >
      {/* Modal */}
      <dialog id="confirmation_modal" class="modal">
        <div class="modal-box glass-panel border border-white/10">
          <h3 class="font-bold text-2xl text-primary">
            {cfpStore.formData.id ? "Changes saved" : "Proposal received"}
          </h3>
          <p class="py-4 text-sm leading-relaxed">
            {cfpStore.formData.id
              ? "You can edit your proposal until the CFP closes."
              : "We've sent you a confirmation email."}
          </p>
          <div class="modal-action">
            <form method="dialog">
              <button
                class="btn btn-primary"
                onClick={handleModalClose}
              >
                Submit another talk
              </button>
            </form>
          </div>
        </div>
      </dialog>

      <p class="text-secondary-300 mb-8 text-sm">
        Check your details before submitting. Committee review is anonymized.
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
        <SummarySection title="Speaker details" step={2}>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-y-2 text-sm text-secondary-300">
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

        <SummarySection title="Talk proposal" step={3}>
          <p class="text-xl font-bold text-white mb-4">
            {cfpStore.formData.talk_title}
          </p>
          <div class="mb-4">
            <p class="font-mono text-xs uppercase text-primary mb-2">
              Abstract
            </p>
            <div
              class="prose prose-invert prose-sm max-w-none text-secondary-300"
              innerHTML={cfpStore.formData.abstract}
            />
          </div>
          <div>
            <p class="font-mono text-xs uppercase text-primary mb-2">
              Takeaways
            </p>
            <div
              class="prose prose-invert prose-sm max-w-none text-secondary-300"
              innerHTML={cfpStore.formData.key_takeaways}
            />
          </div>
        </SummarySection>

        <SummarySection title="Expenses and notes" step={5}>
          <div class="flex items-center gap-3">
            <div
              class={`badge badge-lg h-auto whitespace-normal ${cfpStore.formData.company_cover_expenses === "Yes"
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

      <p class="text-sm text-secondary-300 mt-6">
          You can edit proposal details after submitting. Changes to your{" "}
          <a class="link link-primary" href="/cfp/02-personal">
            personal details
          </a>
          {" "}apply to all your submissions.
      </p>

      <div class="flex flex-col md:flex-row justify-between mt-10 gap-4">
        <button
          onClick={() => navigate("/cfp/05-expenses")}
          class="btn btn-outline flex-1 hover:bg-white/10"
        >
          Back
        </button>
        <button
          onClick={handleSubmit}
          class="btn btn-primary flex-[2] gap-2"
        >
          {cfpStore.formData.id ? "Save changes" : "Submit proposal"}
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

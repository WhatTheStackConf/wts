import { Show, For, createSignal } from "solid-js";
import { Navigate, useNavigate } from "@solidjs/router";
// import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { useCfpStore } from "~/lib/cfp-store";
import { isCfpOpen } from "~/lib/cfp-utils";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";

import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

const Expenses = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [cfpStore, setCfpStore] = useCfpStore();
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  if (!auth || !auth.record) return <Navigate href="/login" />;
  if (!isCfpOpen()) return <Navigate href="/" />;

  const handleNext = () => {
    const currentErrors: Record<string, string> = {};
    if (!cfpStore.formData.company_cover_expenses)
      currentErrors.company_cover_expenses = "Please select an option";

    if (Object.keys(currentErrors).length > 0) {
      setErrors(currentErrors);
      return;
    }

    setErrors({});
    navigate("/cfp/06-confirmation");
  };

  const handlePrevious = () => {
    navigate("/cfp/04-experience");
  };

  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    setCfpStore(
      "formData",
      target.name as keyof typeof cfpStore.formData,
      target.value,
    );
  };

  const setExpenseOption = (val: string) => {
    setCfpStore("formData", "company_cover_expenses", val);
  };



  return (
    <CfpStepLayout
      title="Call for Papers - Step 5"
      description="Step 5: Expenses & Notes"
      step={5}
    >
      <div class="mb-10 space-y-8">
        <h2 class="text-2xl font-bold font-star text-white mb-6 flex items-center gap-3">
          <span class="text-primary">//</span> ADDITIONAL NOTES & LOGISTICS
        </h2>

        {/* Expense Question Section */}
        <div class="bg-base-200/20 p-8 rounded-2xl border border-white/10 relative overflow-hidden">
          <div class="absolute top-0 right-0 p-4 opacity-10">
            <Icon icon="material-symbols:flight-takeoff" class="text-9xl" />
          </div>

          <h3 class="text-lg font-bold text-white mb-2 font-mono uppercase tracking-wide">
            Travel & Accommodation
          </h3>
          <p class="text-sm text-secondary-300 mb-6 font-mono leading-relaxed relative z-10 w-3/4">
            Can your company cover your travel or accommodation expenses? If so,
            we'll gladly list them as a supporter!
          </p>

          <div class="flex flex-wrap gap-4 relative z-10">
            <For each={["Yes", "No", "Other"]}>
              {(option) => (
                <button
                  type="button"
                  onClick={() => setExpenseOption(option)}
                  class={`btn btn-lg flex-1 md:flex-none md:px-12 transition-all font-mono ${cfpStore.formData.company_cover_expenses === option
                      ? "btn-primary shadow-[0_0_20px_rgba(var(--color-primary-500),0.4)] scale-105 border-primary"
                      : "btn-outline border-white/20 text-white bg-base-300/10 hover:bg-white/10"
                    }`}
                >
                  {option === "Yes" && (
                    <Icon
                      icon="material-symbols:check-circle-outline"
                      class="mr-2"
                    />
                  )}
                  {option === "No" && (
                    <Icon
                      icon="material-symbols:cancel-outline"
                      class="mr-2"
                    />
                  )}
                  {option === "Other" && (
                    <Icon
                      icon="material-symbols:help-outline"
                      class="mr-2"
                    />
                  )}
                  {option}
                </button>
              )}
            </For>
          </div>
          <Show when={errors().company_cover_expenses}>
            <div class="flex items-center gap-2 text-error text-sm mt-4 font-bold bg-error/10 p-2 rounded-lg inline-block">
              <Icon icon="material-symbols:warning-outline" />
              {errors().company_cover_expenses}
            </div>
          </Show>
        </div>

        <div class="space-y-8">
          <div class="form-control w-full">
            <label class="label font-mono text-xs uppercase text-primary">
              Internal Notes for Organizers (optional)
            </label>
            <div class="bg-base-300/30 p-1 rounded-xl focus-within:ring-2 ring-primary/50 transition-all border border-white/10">
              <textarea
                name="organizer_notes"
                value={cfpStore.formData.organizer_notes}
                onInput={handleInputChange}
                placeholder="Anything specific the reviewers should know?"
                class="textarea textarea-lg w-full min-h-[120px] bg-transparent border-none focus:outline-none text-white resize-e"
              />
            </div>
            <label class="label text-xs text-secondary-300">
              Won't be public. Use this for things like "I need a visa invite
              letter" or "I can only speak on Day 2".
            </label>
          </div>

          <div class="form-control w-full">
            <label class="label font-mono text-xs uppercase text-primary">
              Final Comments
            </label>
            <div class="bg-base-300/30 p-1 rounded-xl focus-within:ring-2 ring-primary/50 transition-all border border-white/10">
              <textarea
                name="additional_info"
                value={cfpStore.formData.additional_info}
                onInput={handleInputChange}
                placeholder="Is there anything else you'd like to share with us?"
                class="textarea textarea-lg w-full min-h-[120px] bg-transparent border-none focus:outline-none text-white resize-y"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-between mt-12 border-t border-white/10 pt-8">
        <button
          type="button"
          onClick={handlePrevious}
          class="btn btn-outline btn-lg px-8 font-mono hover:bg-white/10"
        >
          BACK
        </button>
        <button
          type="button"
          onClick={handleNext}
          class="btn btn-primary btn-lg shadow-[0_0_20px_rgba(var(--color-primary-500),0.3)] px-12 font-mono"
        >
          REVIEW PROPOSAL <Icon icon="material-symbols:arrow-forward" />
        </button>
      </div>
    </CfpStepLayout>
  );
};

export default clientOnly(async () => ({ default: Expenses }), { lazy: true });

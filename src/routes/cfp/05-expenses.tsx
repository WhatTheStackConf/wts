import { Show, For, createSignal } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { useNavigate } from "@solidjs/router";
import { Redirect } from "~/components/Redirect";
// import { Layout } from "~/layouts/Layout";
import { useRequireAuth } from "~/lib/route-guards";
import { useCfpStore } from "~/lib/cfp-store";
import { isCfpOpen, fetchCfpConfig } from "~/lib/cfp-utils";
import { clientOnly } from "@solidjs/web";
import { Icon } from "~/components/Icon";

import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

const Expenses = () => {
  useRequireAuth();
  const navigate = useNavigate();
  const [cfpStore, setCfpStore] = useCfpStore();
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [cfpConfig] = createResource(fetchCfpConfig);

  if (!isCfpOpen()) return <Redirect href="/cfp/closed" />;

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
      title="Expenses and notes"
      description="Step 5: Expenses & Notes"
      step={5}
    >
      <div class="mb-10 space-y-8">
        {/* Expense Question Section */}
        <div>
          <h2 id="expense-question" class="text-lg font-bold text-white mb-2">
            Can your company cover travel or accommodation? *
          </h2>
          <p class="text-sm text-secondary-300 mb-4">
            If so, we'll list them as a supporter.
          </p>

          <div role="group" aria-labelledby="expense-question" class="flex flex-wrap gap-3">
            <For each={["Yes", "No", "Other"]}>
              {(option) => (
                <button
                  type="button"
                  onClick={() => setExpenseOption(option)}
                  aria-pressed={cfpStore.formData.company_cover_expenses === option ? "true" : "false"}
                  class={`btn flex-1 md:flex-none md:px-8 ${cfpStore.formData.company_cover_expenses === option
                      ? "btn-primary border-primary"
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
            <label class="label text-sm font-medium text-primary">
              Notes for organizers (optional)
            </label>
            <div class="bg-base-300/30 p-1 rounded-xl focus-within:ring-2 ring-primary/50 transition-all border border-white/10">
              <textarea
                name="organizer_notes"
                value={cfpStore.formData.organizer_notes}
                onInput={handleInputChange}
                placeholder="Visa invitation, availability, or other requests"
                class="textarea textarea-lg w-full min-h-[120px] bg-transparent border-none focus:outline-none text-white resize-e"
              />
            </div>
            <label class="label text-xs text-secondary-300">
              Private to organizers. Include visa invitation requests or availability constraints.
            </label>
          </div>

          <div class="form-control w-full">
            <label class="label text-sm font-medium text-primary">
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

      <div class="flex flex-wrap justify-between gap-3 mt-12 border-t border-white/10 pt-8">
        <button
          type="button"
          onClick={handlePrevious}
          class="btn btn-outline hover:bg-white/10"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          class="btn btn-primary gap-2"
        >
          Review proposal <Icon icon="material-symbols:arrow-forward" />
        </button>
      </div>
    </CfpStepLayout>
  );
};

export default clientOnly(async () => ({ default: Expenses }), { lazy: true });

import { useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import { useCfpStore } from "~/lib/cfp-store";
import { isCfpOpen } from "~/lib/cfp-utils";
import { clientOnly } from "@solidjs/start";
import { createEffect, createSignal, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

const RichEditor = clientOnly(() => import("../../components/RichEditor"));

const Proposal = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [cfpStore, setCfpStore] = useCfpStore();
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  if (!auth || !auth.record) navigate("/login");
  if (!isCfpOpen()) navigate("/");

  const handleNext = () => {
    const currentErrors: Record<string, string> = {};

    if (!cfpStore.formData.talk_title)
      currentErrors.talk_title = "Talk title is required";
    if (!cfpStore.formData.abstract)
      currentErrors.abstract = "Abstract is required";
    if (!cfpStore.formData.key_takeaways)
      currentErrors.key_takeaways = "Key takeaways are required";

    if (Object.keys(currentErrors).length > 0) {
      setErrors(currentErrors);
      return;
    }

    setErrors({});
    navigate("/cfp/04-experience");
  };

  const handleInputChange = (e: Event) => {
    console.log(e);
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    setCfpStore(
      "formData",
      target.name as keyof typeof cfpStore.formData,
      target.value,
    );
  };

  const updateField = (name: keyof typeof cfpStore.formData, value: string) => {
    setCfpStore("formData", name, value);
  };

  createEffect(() => { });



  return (
    <CfpStepLayout
      title="Call for Papers - Step 3"
      description="Submit your talk proposal"
      step={3}
    >
      <div class="mb-10 space-y-8">
        <h2 class="text-2xl font-bold font-star text-white mb-6 flex items-center gap-3">
          <span class="text-primary">//</span> PROPOSAL DETAILS
        </h2>
        <div class="mb-6 mx-auto w-full md:w-2/3">
          <div class="p-4 rounded-xl border border-primary/20 bg-primary/5 flex gap-4 items-start">
            <Icon
              icon="material-symbols:timer-outline"
              class="text-primary text-xl shrink-0 mt-1"
            />
            <p class="text-sm font-mono text-secondary-300">
              Please note that the time limit for each talk is 35 minutes in
              total (including Q&A). You can decide how you'd like to allocate
              the time between your talk and Q&A.
            </p>
          </div>
        </div>

        <div class="space-y-6">
          <div class="form-control w-full">
            <label class="label font-mono text-xs uppercase text-primary">
              Title of your talk *
            </label>
            <input
              name="talk_title"
              type="text"
              value={cfpStore.formData.talk_title}
              onInput={handleInputChange}
              placeholder="e.g. Architecting for the..."
              class={`input input-lg input-bordered w-full bg-base-300/30 border-white/10 focus:border-primary focus:outline-none transition-colors font-bold text-white ${errors().talk_title ? "input-error" : ""
                }`}
            />
            <Show when={errors().talk_title}>
              <span class="text-error text-xs mt-1">
                {errors().talk_title}
              </span>
            </Show>
            <label class="label text-xs text-secondary-300">
              Public if your talk is accepted
            </label>
          </div>

          <div class="form-control w-full">
            <label class="label font-mono text-xs uppercase text-primary">
              Abstract *
            </label>
            <RichEditor
              value={cfpStore.formData.abstract}
              onInput={(val) => updateField("abstract", val)}
              error={errors().abstract}
              placeholder="Describe your talk to the attendees..."
            />
            <label class="label text-xs text-secondary-300">
              Public if your talk is accepted
            </label>
          </div>

          <div class="form-control w-full">
            <label class="label font-mono text-xs uppercase text-primary">
              Key takeaways
            </label>
            <RichEditor
              value={cfpStore.formData.key_takeaways}
              onInput={(val) => updateField("key_takeaways", val)}
              error={errors().key_takeaways}
              placeholder="What 3-5 things will the audience learn?"
            />
            <label class="label text-xs text-secondary-300">
              Public if your talk is accepted
            </label>
          </div>

          <div class="form-control w-full">
            <label class="label font-mono text-xs uppercase text-primary">
              Technical requirements / Additional notes
            </label>
            <textarea
              name="technical_requirements"
              value={cfpStore.formData.technical_requirements}
              onInput={handleInputChange}
              class="textarea textarea-lg textarea-bordered w-full bg-base-300/30 border-white/10 focus:border-primary focus:outline-none transition-colors text-white"
              rows={4}
              placeholder="e.g. I need to plug in my own device, or special audio requirements."
            />
            <label class="label text-xs text-secondary-300">
              By default, we assume you'll use your own laptop. You can
              connect to the projector via HDMI or type-c.
            </label>
          </div>
        </div>
      </div>

      <div class="flex justify-between mt-12 border-t border-white/10 pt-8">
        <button
          class="btn btn-outline btn-lg px-8 font-mono hover:bg-white/10"
          onClick={() => navigate("/cfp/02-personal")}
        >
          BACK
        </button>
        <button
          class="btn btn-primary btn-lg shadow-[0_0_20px_rgba(var(--color-primary-500),0.3)] px-10 font-mono"
          onClick={handleNext}
        >
          NEXT <Icon icon="material-symbols:arrow-forward" />
        </button>
      </div>
    </CfpStepLayout>
  );
};

export default clientOnly(async () => ({ default: Proposal }), { lazy: true });

import { useNavigate } from "@solidjs/router";
import { useRequireAuth } from "~/lib/route-guards";
import { useCfpStore } from "~/lib/cfp-store";
import { isCfpOpen, fetchCfpConfig } from "~/lib/cfp-utils";
import { clientOnly } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { Icon } from "~/components/Icon";
import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

const RichEditor = clientOnly(() => import("../../components/RichEditor"));

const Proposal = () => {
  useRequireAuth();
  const navigate = useNavigate();
  const [cfpStore, setCfpStore] = useCfpStore();
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [cfpConfig] = createResource(fetchCfpConfig);

  if (!isCfpOpen()) navigate("/cfp/closed");

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


  return (
    <CfpStepLayout
      title="Talk proposal"
      description="Submit your talk proposal"
      step={3}
    >
      <div class="mb-10 space-y-8">
        <p class="text-sm text-secondary-300">
          Talks are 35 minutes including Q&A; you choose the split. For a workshop,
          lightning talk, or another format, include your estimated duration.
        </p>

        <div class="space-y-6">
          <div class="form-control w-full">
            <label class="label text-sm font-medium text-primary">
              Title of your talk *
            </label>
            <input
              name="talk_title"
              type="text"
              value={cfpStore.formData.talk_title}
              onInput={handleInputChange}
              placeholder="e.g. Architecting for the..."
              class={`input input-lg input-bordered w-full bg-base-300/30 border-white/10 focus:border-primary focus:outline-none transition-colors font-bold text-white ${
                errors().talk_title ? "input-error" : ""
              }`}
            />
            <Show when={errors().talk_title}>
              <span class="text-error text-xs mt-1">{errors().talk_title}</span>
            </Show>
            <label class="label text-xs text-secondary-300">
              Public if your talk is accepted
            </label>
          </div>

          <div class="form-control w-full">
            <label class="label text-sm font-medium text-primary">
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
            <label class="label text-sm font-medium text-primary">
              Key takeaways *
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
            <label class="label text-sm font-medium text-primary">
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
              Default setup: your own laptop connected to the projector via HDMI or USB-C.
            </label>
          </div>
        </div>
      </div>

      <div class="flex justify-between mt-12 border-t border-white/10 pt-8">
        <button
          class="btn btn-outline hover:bg-white/10"
          onClick={() => navigate("/cfp/02-personal")}
        >
          Back
        </button>
        <button
          class="btn btn-primary gap-2"
          onClick={handleNext}
        >
          Next <Icon icon="material-symbols:arrow-forward" />
        </button>
      </div>
    </CfpStepLayout>
  );
};

export default clientOnly(async () => ({ default: Proposal }), { lazy: true });

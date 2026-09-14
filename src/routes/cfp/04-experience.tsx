import { useNavigate } from "@solidjs/router";
import { Redirect } from "~/components/Redirect";
// import { Layout } from "~/layouts/Layout";
import { useRequireAuth } from "~/lib/route-guards";
import { useCfpStore } from "~/lib/cfp-store";
import { isCfpOpen, fetchCfpConfig } from "~/lib/cfp-utils";
import { clientOnly } from "@solidjs/web";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { Icon } from "~/components/Icon";

import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

const Experience = () => {
  useRequireAuth();
  const navigate = useNavigate();
  const [cfpStore, setCfpStore] = useCfpStore();
  const [cfpConfig] = createResource(fetchCfpConfig);

  if (!isCfpOpen()) return <Redirect href="/cfp/closed" />;

  const handleNext = () => {
    // No strict validation required for this step
    // No strict validation required for this step
    navigate("/cfp/05-expenses");
  };

  const handlePrevious = () => {
    navigate("/cfp/03-proposal");
  };

  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    setCfpStore(
      "formData",
      target.name as keyof typeof cfpStore.formData,
      target.value,
    );
  };



  return (
    <CfpStepLayout
      title="Speaking experience"
      description="Step 4: Previous Speaking Experiences"
      step={4}
    >
      <div class="mb-10 space-y-8">
        <p class="text-sm text-secondary-300">
          This step is optional. First-time speakers are welcome; previous experience
          carries little weight in selection.
        </p>

        <div class="space-y-6">
          <div class="form-control w-full">
            <label
              for="previous_presentation"
              class="label text-sm font-medium text-primary"
            >
              Have you presented this topic before?
            </label>
            <textarea
              id="previous_presentation"
              name="previous_presentation"
              value={cfpStore.formData.previous_presentation}
              onInput={handleInputChange}
              placeholder="If yes, please tell us where and when, and share some links if applicable."
              class="textarea textarea-lg textarea-bordered w-full bg-base-300/30 border-white/10 focus:border-primary focus:outline-none transition-colors text-white"
              rows={4}
            ></textarea>
          </div>

          <div class="form-control w-full">
            <label
              for="previous_talk_links"
              class="label text-sm font-medium text-primary"
            >
              Links to previous talks or your speaker profile
            </label>
            <textarea
              id="previous_talk_links"
              name="previous_talks"
              value={cfpStore.formData.previous_talks}
              onInput={handleInputChange}
              class="textarea textarea-lg textarea-bordered w-full bg-base-300/30 border-white/10 focus:border-primary focus:outline-none transition-colors text-white"
              rows={4}
              placeholder="https://youtube.com/watch?v=...&#10;https://sessionize.com/user/..."
            ></textarea>
            <div class="label text-xs text-secondary-300 flex flex-col items-start gap-1">
              <span>
                Videos, slide decks, or profiles (Sessionize, Notist, etc.)
              </span>
              <span class="opacity-60">
                Saved to your speaker profile.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-between mt-12 border-t border-white/10 pt-8">
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
          Next <Icon icon="material-symbols:arrow-forward" />
        </button>
      </div>
    </CfpStepLayout>
  );
};

export default clientOnly(async () => ({ default: Experience }), {
  lazy: true,
});

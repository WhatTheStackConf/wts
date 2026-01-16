import { Navigate, useNavigate } from "@solidjs/router";
// import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { useCfpStore } from "~/lib/cfp-store";
import { isCfpOpen } from "~/lib/cfp-utils";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";

import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

const Experience = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [cfpStore, setCfpStore] = useCfpStore();

  if (!auth || !auth.record) return <Navigate href="/login" />;
  if (!isCfpOpen()) return <Navigate href="/" />;

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
      title="Call for Papers - Step 4"
      description="Step 4: Previous Speaking Experiences"
      step={4}
    >
      <div class="mb-10 space-y-8">
        <h2 class="text-2xl font-bold font-star text-white mb-6 flex items-center gap-3">
          <span class="text-primary">//</span> PREVIOUS EXPERIENCES
        </h2>

        <div class="mb-6 mx-auto w-full md:w-2/3">
          <div class="p-4 rounded-xl border border-primary/20 bg-primary/5 flex gap-4 items-start">
            <Icon
              icon="material-symbols:school-outline"
              class="text-primary text-xl shrink-0 mt-1"
            />
            <p class="text-sm font-mono text-secondary-300">
              Protip: Previous speaking experience is <strong>not</strong> a
              requirement. We encourage first-time speakers to apply! Your
              previous speaking experience (or lack thereof) doesn't count for
              much towards acceptance.
            </p>
          </div>
        </div>

        <div class="space-y-6">
          <div class="form-control w-full">
            <label
              for="previous_presentation"
              class="label font-mono text-xs uppercase text-primary"
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
              class="label font-mono text-xs uppercase text-primary"
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
                Note: this field is for your previous presentations and gets
                saved to your speaker profile.
              </span>
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
          class="btn btn-primary btn-lg shadow-[0_0_20px_rgba(var(--color-primary-500),0.3)] px-10 font-mono"
        >
          NEXT <Icon icon="material-symbols:arrow-forward" />
        </button>
      </div>
    </CfpStepLayout>
  );
};

export default clientOnly(async () => ({ default: Experience }), {
  lazy: true,
});

import { createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
// Removed Layout
// import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { useCfpStore } from "~/lib/cfp-store";
import { isCfpOpen } from "~/lib/cfp-utils";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";

import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

const Intro = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [cfpStore, setCfpStore] = useCfpStore();
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  if (!auth || !auth.record) {
    navigate("/login");
  }

  if (!isCfpOpen()) {
    navigate("/");
  }

  // Initialize form data with user's info if not already set
  onMount(() => {
    if (!cfpStore?.formData?.email && auth?.record) {
      setCfpStore("formData", {
        ...cfpStore.formData,
        email: auth.record.email || "",
        full_name: auth.record.name || "", // Assuming user profile has a name field
      });
    }
  });

  const handleNext = () => {
    // Validate current step before proceeding
    const currentErrors: Record<string, string> = {};

    // Validate email
    if (!cfpStore.formData.email) {
      currentErrors.email = "Email is required";
    } else if (!/\S+@\S+\.\S+/.test(cfpStore.formData.email)) {
      currentErrors.email = "Email is invalid";
    }

    if (Object.keys(currentErrors).length > 0) {
      setErrors(currentErrors);
      return;
    }

    setErrors({});
    navigate("/cfp/02-personal");
  };



  return (
    <CfpStepLayout
      title="Call for Papers - Step 1"
      description="Submit your talk proposal for WhatTheStack 2026 - Step 1: Introduction"
      step={1}
    >
      <div class="mb-10">
        <h2 class="text-2xl font-bold font-star text-white mb-6 flex items-center gap-3">
          <span class="text-primary">//</span> INTRODUCTION
        </h2>
        <div class="prose prose-invert prose-lg max-w-none text-gray-200 leading-relaxed">
          <p>
            Do you love software development (of any kind) and love
            talking about it? So do we. Plus, we have a few stages you can
            do that talking on. This is our official CfP form for
            WhatTheStack 2026.
          </p>
          <div class="bg-base-300/30 p-6 rounded-xl border border-white/5 my-6">
            <p class="mt-0 text-secondary-300">
              Each CfP submission will be anonymized before being
              carefully reviewed by our committee. We'll be in touch after
              each round of decisions and we'll keep things transparent.
              Thanks for the interest and for taking the time to apply to
              WhatTheStack 2026!
            </p>
          </div>
          <p>
            If you're not sure what to talk about, we've got a few ideas:
          </p>
          <ul class="list-none space-y-2 pl-0">
            {[
              "How to build a thing with React/Flutter/Electron/Express/Laravel/Rails/Your own framework?",
              "AI's AbOUt tO RePlAce uS!!1! (But better make it a good one. We mean it.)",
              "The latest in serverless, containers, or why sticking to a VPS is still a good idea.",
              "Machine learning, LLMs, and how to use them to solve real-world problems (ideally not just via chatbots).",
              "I built/hacked something together that I'm proud of and want to share with the world.",
              "Why soft skills matter in the tech industry.",
            ].map((item) => (
              <li class="flex items-start gap-3 pl-0">
                <span class="text-primary mt-1.5">›</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p>
            That's a pretty wide range of example already, but even if you
            don't see your intended topic (topic space?) covered, please
            apply - we aim to widen the array of topics covered this time
            around.
          </p>
          <div class="bg-primary/5 border border-primary/20 p-6 rounded-xl relative overflow-hidden text-secondary-300">
            <div class="absolute top-0 right-0 w-20 h-20 bg-primary/10 rounded-bl-full -mr-10 -mt-10"></div>
            <p class="font-bold text-white mb-2 relative z-10">
              EXPENSES COVERED
            </p>
            <p class="text-sm m-0 relative z-10">
              Note: If your talk gets chosen, we're covering travel and
              accommodation expenses in full. If your employer is willing
              to cover that, we'll be happy to list them as a supporter
              during the WTS promo campaign - just make sure to specify
              that in the related question later in the application.
            </p>
          </div>
        </div>

        <div class="mt-8 p-4 bg-base-300/50 rounded-lg border border-white/10 font-mono text-sm flex items-center gap-3 text-secondary-300">
          <Icon
            icon="material-symbols:mark-email-read-outline"
            class="text-xl text-primary"
          />
          <span>
            Logged in as{" "}
            <span class="text-white font-bold">
              {auth?.record?.email}
            </span>
          </span>
        </div>
      </div>

      <div class="flex justify-between mt-12 border-t border-white/10 pt-8">
        {/* No previous button for step 1 */}
        <div></div>
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

export default clientOnly(async () => ({ default: Intro }), { lazy: true });
// export default Intro;

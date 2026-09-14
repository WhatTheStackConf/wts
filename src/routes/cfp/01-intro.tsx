import { createEffect, createSignal } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { useNavigate } from "@solidjs/router";
// Removed Layout
// import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { useRequireAuth } from "~/lib/route-guards";
import { useCfpStore } from "~/lib/cfp-store";
import { isCfpOpen, fetchCfpConfig } from "~/lib/cfp-utils";
import { clientOnly } from "@solidjs/web";
import { Icon } from "~/components/Icon";

import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

const Intro = () => {
  const auth = useAuth();
  const guard = useRequireAuth();
  const navigate = useNavigate();
  const [cfpStore, setCfpStore] = useCfpStore();
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [cfpConfig] = createResource(fetchCfpConfig);

  if (!isCfpOpen()) {
    navigate("/cfp/closed");
  }

  // Initialize form data with user's info if not already set
  createEffect(
    () => ({
      authorized: guard.authorized(),
      email: cfpStore.formData.email,
      record: auth.record,
    }),
    ({ authorized, email, record }) => {
    if (authorized && !email && record) {
      setCfpStore("formData", {
        ...cfpStore.formData,
        email: record.email || "",
        full_name: record.name || "", // Assuming user profile has a name field
      });
    }
    },
  );

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
      title="Submit a talk"
      description="Submit your talk proposal for WhatTheStack 2026 - Step 1: Introduction"
      step={1}
    >
      <div class="mb-10">

        <div class="space-y-5 text-sm text-secondary-300 leading-relaxed">
          <p>Propose a software-development talk for WhatTheStack 2026. Submissions are anonymized for committee review; we'll notify you after each decision round.</p>
          <section class="border-t border-white/10 pt-4" aria-labelledby="cfp-expenses-heading">
            <h2 id="cfp-expenses-heading" class="font-bold text-white mb-2">Travel and accommodation</h2>
            <p>We cover both in full for accepted talks. If your employer covers them, mention it in the Expenses step so we can list them as a supporter during the WTS promo campaign.</p>
          </section>
          <details class="border-t border-white/10 pt-2">
            <summary class="cursor-pointer min-h-12 py-3 font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Topic ideas</summary>
            <ul class="list-disc space-y-2 pl-5">
              <li>Building with frameworks, tools, or your own project.</li>
              <li>Serverless, containers, infrastructure, or a VPS.</li>
              <li>Practical machine learning, LLMs, or AI's impact on development.</li>
              <li>Soft skills and lessons from working in tech.</li>
            </ul>
            <p class="mt-3">Other software-development topics are welcome.</p>
          </details>
        </div>

        <div class="mt-8 p-4 bg-base-300/50 rounded-lg border border-white/10 font-mono text-sm flex items-center gap-3 text-secondary-300">
          <Icon
            icon="material-symbols:mark-email-read-outline"
            class="text-xl text-primary"
          />
          <span class="min-w-0 [overflow-wrap:anywhere]">
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
          class="btn btn-primary gap-2"
        >
          Next <Icon icon="material-symbols:arrow-forward" />
        </button>
      </div>
    </CfpStepLayout>
  );
};

export default clientOnly(async () => ({ default: Intro }), { lazy: true });
// export default Intro;

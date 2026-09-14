import { createEffect, createSignal, Show } from "solid-js";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import { useRequireAuth } from "~/lib/route-guards";
import {
  fetchApplicantData,
  useCfpStore,
  updateApplicant,
} from "~/lib/cfp-store";
import { isCfpOpen, fetchCfpConfig } from "~/lib/cfp-utils";
import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";
import { clientOnly } from "@solidjs/web";
import { Icon } from "~/components/Icon";
import { SmartArea } from "../../components/SmartArea";

const Personal = () => {
  const auth = useAuth();
  const guard = useRequireAuth();
  const navigate = useNavigate();
  const [cfpStore, setCfpStore] = useCfpStore();
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [cfpConfig] = createResource(fetchCfpConfig);

  if (!isCfpOpen()) navigate("/cfp/closed");

  createEffect(
    () => ({ authorized: guard.authorized(), record: auth.record }),
    ({ authorized, record }) => {
      if (!authorized) return;
      let cancelled = false;
      void (async () => {
        const applicantData = await fetchApplicantData();
        if (cancelled) return;
        const data = applicantData?.[0];

        if (data || record) {
          const rawHandles = data?.social_handles;
          const socialHandlesArray = Array.isArray(rawHandles)
            ? rawHandles
            : typeof rawHandles === "string"
              ? rawHandles
                ? [rawHandles]
                : []
              : [];

          setCfpStore("formData", {
            ...cfpStore.formData,
            full_name: cfpStore.formData.full_name || record?.name || "",
            email: record?.email || "",
            short_bio: data?.bio || "",
            affiliation: data?.affiliation || "",
            social_handles: socialHandlesArray,
            preferred_contact: data?.preferred_contact_method || "",
            applicant_id: data?.id || "",
          });
        }
      })();
      return () => {
        cancelled = true;
      };
    },
  );

  const handleNext = async () => {
    const user = auth.record;
    if (!user) return;
    const currentErrors: Record<string, string> = {};
    if (!cfpStore.formData.full_name)
      currentErrors.full_name = "Full name is required";
    if (!cfpStore.formData.short_bio)
      currentErrors.short_bio = "Short bio is required";

    if (Object.keys(currentErrors).length > 0) {
      setErrors(currentErrors);
      return;
    }

    await updateApplicant({
      affiliation: cfpStore.formData.affiliation,
      bio: cfpStore.formData.short_bio,
      social_handles: cfpStore.formData.social_handles.filter(
        (h) => h.trim() !== "",
      ),
      preferred_contact_method: cfpStore.formData.preferred_contact,
      previous_talks: cfpStore.formData.previous_talks,
    });

    setErrors({});
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

  const updateSocials = (links: string[]) => {
    setCfpStore("formData", "social_handles", links);
  };



  return (
    <CfpStepLayout
      title="Personal details"
      description="Submit your talk proposal"
      step={2}
    >
      <div class="mb-10 space-y-8">
        <p class="text-sm text-secondary-300">
          These details are reused for every proposal. Changes update your profile across all submissions.
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="form-control w-full">
            <label class="label text-sm font-medium text-primary">
              Email
            </label>
            <input
              type="email"
              value={cfpStore.formData.email}
              class="input input-lg input-bordered w-full bg-base-300/50 border-white/10 text-secondary-300 cursor-not-allowed font-mono text-sm"
              disabled
            />
            <label class="label text-xs text-white/30 truncate">
              Cannot be changed
            </label>
          </div>
          <div class="form-control w-full">
            <label class="label text-sm font-medium text-primary">
              Full Name *
            </label>
            <input
              name="full_name"
              type="text"
              value={cfpStore.formData.full_name}
              onInput={handleInputChange}
              class={`input input-lg input-bordered w-full bg-base-300/30 border-white/10 focus:border-primary focus:outline-none transition-colors font-bold text-white ${errors().full_name ? "input-error" : ""
                }`}
              placeholder="Jane Doe"
            />
            <Show when={errors().full_name}>
              <span class="text-error text-xs mt-1">
                {errors().full_name}
              </span>
            </Show>
            <label class="label text-xs text-secondary-300">
              Public if your talk is accepted
            </label>
          </div>
        </div>

        <div class="form-control w-full">
          <label class="label text-sm font-medium text-primary">
            Affiliation and Title
          </label>
          <input
            name="affiliation"
            type="text"
            value={cfpStore.formData.affiliation}
            onInput={handleInputChange}
            class="input input-lg input-bordered w-full bg-base-300/30 border-white/10 focus:border-primary focus:outline-none transition-colors text-white"
            placeholder="Senior Engineer @ Tech Corp"
          />
          <label class="label text-xs text-secondary-300">
            Public if your talk is accepted
          </label>
        </div>

        <div class="form-control w-full">
          <label class="label text-sm font-medium text-primary">
            Short Bio *
          </label>
          <textarea
            name="short_bio"
            value={cfpStore.formData.short_bio}
            onInput={handleInputChange}
            class={`textarea textarea-lg textarea-bordered w-full bg-base-300/30 border-white/10 focus:border-primary focus:outline-none transition-colors text-white leading-relaxed ${errors().short_bio ? "textarea-error" : ""
              }`}
            rows={6}
            placeholder="Tell us a bit about yourself..."
          />
          <Show when={errors().short_bio}>
            <span class="text-error text-xs mt-1">{errors().short_bio}</span>
          </Show>
          <label class="label text-xs text-secondary-300">
            Public if your talk is accepted
          </label>
        </div>

        <div class="form-control w-full">
          <label class="label text-sm font-medium text-primary">
            Social Media & Personal Links
          </label>
          <div class="bg-base-300/30 rounded-xl border border-white/10 p-2">
            <SmartArea
              value={cfpStore.formData.social_handles}
              onChange={updateSocials}
            />
          </div>
          <label class="label text-xs text-secondary-300">
            Public if your talk is accepted (one link per line)
          </label>
        </div>

        <div class="form-control w-full">
          <label class="label text-sm font-medium text-primary">
            Preferred Contact Method
          </label>
          <input
            name="preferred_contact"
            type="text"
            value={cfpStore.formData.preferred_contact}
            onInput={handleInputChange}
            class="input input-lg input-bordered w-full bg-base-300/30 border-white/10 focus:border-primary focus:outline-none transition-colors text-white"
            placeholder="Email, Twitter DM, etc."
          />
        </div>
      </div>

      <div class="flex justify-between mt-12 border-t border-white/10 pt-8">
        <button
          class="btn btn-outline hover:bg-white/10"
          onClick={() => navigate("/cfp/01-intro")}
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

export default clientOnly(async () => ({ default: Personal }), { lazy: true });

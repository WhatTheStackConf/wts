import { createSignal, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import {
  fetchApplicantData,
  useCfpStore,
  updateApplicant,
} from "~/lib/cfp-store";
import { isCfpOpen } from "~/lib/cfp-utils";
import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";
import { SmartArea } from "../../components/SmartArea";

const Personal = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [cfpStore, setCfpStore] = useCfpStore();
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  if (!auth || !auth.record) navigate("/login");
  if (!isCfpOpen()) navigate("/");

  onMount(async () => {
    const applicantData = await fetchApplicantData();
    const data = applicantData?.[0];

    // Initialize logic combined for both new and returning users
    if (data || auth.record) {
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
        full_name: cfpStore.formData.full_name || auth.record?.name || "",
        email: auth.record?.email || "",
        short_bio: data?.bio || "",
        affiliation: data?.affiliation || "",
        social_handles: socialHandlesArray,
        preferred_contact: data?.preferred_contact_method || "",
        applicant_id: data?.id || "",
      });
    }
  });

  const handleNext = async () => {
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
      user: auth.record.id,
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
      title="Call for Papers - Step 2"
      description="Submit your talk proposal"
      step={2}
    >
      <div class="mb-10 space-y-8">
        <h2 class="text-2xl font-bold font-star text-white mb-6 flex items-center gap-3">
          <span class="text-primary">//</span> PERSONAL INFO
        </h2>

        <div class="mb-6 mx-auto w-full md:w-2/3">
          <div class="p-4 rounded-xl border border-primary/20 bg-primary/5 flex gap-4 items-start">
            <Icon
              icon="material-symbols:info-outline"
              class="text-primary text-xl shrink-0 mt-1"
            />
            <p class="text-sm font-mono text-secondary-300">
              Protip: you only have to fill out this step once - any
              subsequent talk submission will reuse this data. Editing info in
              the step will update your profile for all your submissions.
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="form-control w-full">
            <label class="label font-mono text-xs uppercase text-primary">
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
            <label class="label font-mono text-xs uppercase text-primary">
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
          <label class="label font-mono text-xs uppercase text-primary">
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
          <label class="label font-mono text-xs uppercase text-primary">
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
          <label class="label font-mono text-xs uppercase text-primary">
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
          <label class="label font-mono text-xs uppercase text-primary">
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
          class="btn btn-outline btn-lg px-8 font-mono hover:bg-white/10"
          onClick={() => navigate("/cfp/01-intro")}
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

export default clientOnly(async () => ({ default: Personal }), { lazy: true });

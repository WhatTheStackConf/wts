import { createStore } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import pb from "./pocketbase";
import { CfpApplicantRecord } from "./pocketbase-types";

// Define the structure of our CFP form data
export interface CfpFormData {
  id?: string; // Submission ID for editing
  email: string;
  full_name: string;
  affiliation: string;
  short_bio: string;
  social_handles: string[];
  preferred_contact: string;
  talk_title: string;
  abstract: string;
  key_takeaways: string;
  technical_requirements: string;
  previous_presentation: string;
  description: string;
  company_cover_expenses: string;
  additional_info: string;
  previous_talks?: string;
  applicant_id: string;
  organizer_notes: string;
}

// Define the structure of our store
export interface CfpStore {
  formData: CfpFormData;
  step: number;
}

// Create the initial store state
const initialStore: CfpStore = {
  formData: {
    id: "",
    email: "",
    full_name: "",
    affiliation: "",
    short_bio: "",
    social_handles: [],
    preferred_contact: "",
    talk_title: "",
    abstract: "",
    key_takeaways: "",
    technical_requirements: "",
    previous_presentation: "",
    description: "",
    company_cover_expenses: "",
    additional_info: "",
    applicant_id: "",
    previous_talks: "",
    organizer_notes: "",
  },
  step: 1,
};

// Create the persisted store
export const [cfpStore, setCfpStore] = makePersisted(
  createStore<CfpStore>(initialStore),
  { name: "cfp-form-data" },
);

// Create a context provider hook to access the store
export const useCfpStore = () => [cfpStore, setCfpStore] as const;

export const fetchApplicantData = async () => {
  if (!pb.authStore.isValid) return null;
  if (pb.authStore && pb.authStore.record) {
    const res = await pb.collection("cfp_applicants").getFullList({
      filter: `user.id = '${pb.authStore.record.id}'`,
    });

    return res;
  }

  return [];
};

export const updateApplicant = async (
  data: Pick<
    CfpApplicantRecord,
    | "user"
    | "affiliation"
    | "bio"
    | "social_handles"
    | "preferred_contact_method"
    | "previous_talks"
  >,
) => {
  let res;

  if (cfpStore.formData.applicant_id) {
    res = await pb
      .collection("cfp_applicants")
      .update(cfpStore.formData.applicant_id, data);
  } else {
    res = await pb.collection("cfp_applicants").create(data);
  }

  return res;
};

// Function to load a submission into the store for editing
export const loadSubmissionToStore = (submission: any) => {
  // Convert social handles from string to array if needed
  const socialHandles = submission.social_handles;
  const socialHandlesArray = Array.isArray(socialHandles)
    ? socialHandles
    : typeof socialHandles === "string"
      ? socialHandles
        ? [socialHandles]
        : []
      : socialHandles || [];

  // Extract meta fields if they exist
  const meta = submission.meta || {};

  // Extract applicant data from expansion if available
  const applicant = submission.expand?.applicant || {};

  setCfpStore("formData", {
    id: submission.id || "",
    email: submission.email || pb.authStore.record?.email || "",
    full_name: submission.full_name || pb.authStore.record?.name || "",
    affiliation: submission.affiliation || applicant.affiliation || "",
    short_bio: submission.bio || applicant.bio || "",
    social_handles: socialHandlesArray.length > 0 ? socialHandlesArray : (applicant.social_handles || []),
    preferred_contact: submission.preferred_contact_method || applicant.preferred_contact_method || "",
    talk_title: submission.session_title || submission.talk_title || "",
    abstract: submission.abstract || "",
    key_takeaways: submission.key_takeaways || "",
    technical_requirements: submission.technical_requirements || "",
    previous_presentation: meta.previous_presentation || submission.previous_presentation || "",
    description: submission.description || meta.description || "",
    company_cover_expenses: meta.company_cover_expenses || submission.company_cover_expenses || "",
    additional_info: meta.additional_info || submission.additional_info || "",
    applicant_id: submission.applicant || submission.applicant_id || applicant.id || "",
    previous_talks: applicant.previous_talks || submission.previous_talks || "",
    organizer_notes: meta.organizer_notes || submission.organizer_notes || "",
  });

  // Set step to 1 to start editing from the beginning
  setCfpStore("step", 1);
};

export const resetProposalData = () => {
  const resetState = {
    ...cfpStore.formData,
    id: "",
    talk_title: "",
    previous_presentation: "",
    description: "",
    company_cover_expenses: "",
    additional_info: "",
    // applicant_id: "", // Keep applicant_id
    // previous_talks: "", // Keep previous talks
    organizer_notes: "",
    key_takeaways: "",
    abstract: "",
    technical_requirements: "",
  };

  setCfpStore("formData", resetState);
  setCfpStore("step", 1); // Also reset step to 1
};

export const submitProposal = async () => {
  const formData = cfpStore.formData;

  if (formData.applicant_id) {
    try {
      await pb.collection("cfp_applicants").update(formData.applicant_id, {
        previous_talks: formData.previous_talks,
      });
    } catch (e) {
      console.error("Failed to update applicant", e);
    }
  }

  const payload = {
    session_title: formData.talk_title,
    abstract: formData.abstract,
    key_takeaways: formData.key_takeaways,
    technical_requirements: formData.technical_requirements,
    description: formData.description,
    applicant: formData.applicant_id,
    meta: {
      company_cover_expenses: formData.company_cover_expenses,
      previous_presentation: formData.previous_presentation,
      additional_info: formData.additional_info,
      organizer_notes: formData.organizer_notes,
    },
  };

  let res;
  if (formData.id) {
    // Update existing submission
    res = await pb.collection("cfp_submissions").update(formData.id, payload);
  } else {
    // Create new submission
    res = await pb.collection("cfp_submissions").create(payload);
  }

  resetProposalData();

  return res;
};

export const fetchProposals = async () => {
  try {
    const res = await pb.collection("cfp_submissions").getFullList({
      sort: "-created",
      expand: "applicant",
    });

    console.log(res);

    return res;
  } catch (error) {
    console.error("Error fetching proposals:", error);
  }
};

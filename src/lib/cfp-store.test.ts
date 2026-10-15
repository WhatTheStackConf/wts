import { describe, expect, it } from "vite-plus/test";
import { snapshot } from "solid-js";
import { cfpStore, loadSubmissionToStore, setCfpStore } from "~/lib/cfp-store";

function formData() {
  return snapshot(cfpStore).formData;
}

describe("loadSubmissionToStore", () => {
  it("prefers submission fields, then meta, then the expanded applicant", () => {
    setCfpStore("step", 3);
    loadSubmissionToStore({
      id: "submission-1",
      email: "speaker@example.test",
      full_name: "Submission Name",
      affiliation: "Submission Org",
      bio: "Submission bio",
      social_handles: "@speaker",
      preferred_contact_method: "email",
      session_title: "Session title",
      talk_title: "Ignored talk title",
      abstract: "Abstract",
      key_takeaways: "Takeaways",
      technical_requirements: "Projector",
      previous_presentation: "Ignored presentation",
      applicant: "applicant-1",
      previous_talks: "Submission talks",
      organizer_notes: "Ignored notes",
      meta: {
        previous_presentation: "Meta presentation",
        company_cover_expenses: "yes",
        additional_info: "Meta info",
        organizer_notes: "Meta notes",
      },
      expand: {
        applicant: {
          id: "applicant-expanded",
          affiliation: "Applicant Org",
          bio: "Applicant bio",
          social_handles: ["@applicant"],
          preferred_contact_method: "phone",
          previous_talks: "Applicant talks",
        },
      },
    }, { email: "identity@example.test", name: "Identity Name" });

    expect(cfpStore.step).toBe(1);
    expect(formData()).toEqual({
      id: "submission-1",
      email: "speaker@example.test",
      full_name: "Submission Name",
      affiliation: "Submission Org",
      short_bio: "Submission bio",
      social_handles: ["@speaker"],
      preferred_contact: "email",
      talk_title: "Session title",
      abstract: "Abstract",
      key_takeaways: "Takeaways",
      technical_requirements: "Projector",
      previous_presentation: "Meta presentation",
      company_cover_expenses: "yes",
      additional_info: "Meta info",
      applicant_id: "applicant-1",
      previous_talks: "Applicant talks",
      organizer_notes: "Meta notes",
    });
  });

  it("falls back to identity, applicant, legacy fields, and empty values", () => {
    loadSubmissionToStore({
      social_handles: "",
      talk_title: "Legacy title",
      previous_presentation: "Legacy presentation",
      company_cover_expenses: "no",
      additional_info: "Legacy info",
      applicant_id: "legacy-applicant",
      previous_talks: "Legacy talks",
      organizer_notes: "Legacy notes",
      expand: {
        applicant: {
          id: "applicant-expanded",
          affiliation: "Applicant Org",
          bio: "Applicant bio",
          social_handles: ["@applicant"],
          preferred_contact_method: "phone",
        },
      },
    }, { email: "identity@example.test", name: "Identity Name" });

    expect(formData()).toEqual({
      id: "",
      email: "identity@example.test",
      full_name: "Identity Name",
      affiliation: "Applicant Org",
      short_bio: "Applicant bio",
      social_handles: ["@applicant"],
      preferred_contact: "phone",
      talk_title: "Legacy title",
      abstract: "",
      key_takeaways: "",
      technical_requirements: "",
      previous_presentation: "Legacy presentation",
      company_cover_expenses: "no",
      additional_info: "Legacy info",
      applicant_id: "legacy-applicant",
      previous_talks: "Legacy talks",
      organizer_notes: "Legacy notes",
    });
  });

  it("keeps the stored identity and uses the applicant id when nothing else is known", () => {
    loadSubmissionToStore({ social_handles: ["@array"] }, { email: "stored@example.test", name: "Stored Name" });
    loadSubmissionToStore({ social_handles: 7, expand: { applicant: { id: "applicant-only" } } });

    expect(formData()).toEqual({
      id: "",
      email: "stored@example.test",
      full_name: "Stored Name",
      affiliation: "",
      short_bio: "",
      social_handles: [],
      preferred_contact: "",
      talk_title: "",
      abstract: "",
      key_takeaways: "",
      technical_requirements: "",
      previous_presentation: "",
      company_cover_expenses: "",
      additional_info: "",
      applicant_id: "applicant-only",
      previous_talks: "",
      organizer_notes: "",
    });

    loadSubmissionToStore({ social_handles: ["@array"] });
    expect(formData().social_handles).toEqual(["@array"]);
  });
});

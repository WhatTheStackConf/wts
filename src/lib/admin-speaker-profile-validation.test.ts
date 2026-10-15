import { describe, expect, it } from "vite-plus/test";
import { isDuplicateFieldError, normalizeSpeakerProfileUpdateInput } from "~/lib/admin-speaker-profile";

describe("isDuplicateFieldError", () => {
  it.each<[string, unknown, boolean]>([
    ["a field-level unique message that names the field", { response: { data: { slug: { message: "The slug must be unique." } } } }, true],
    ["a field-level unique message that omits the field name", { response: { data: { slug: { message: "Value must be unique." } } } }, false],
    ["an error naming the field as already used", new Error("slug is already taken"), true],
    ["a constraint failure string", "UNIQUE constraint failed: speakers.slug", true],
    ["a uniqueness message for another field", { response: { data: { email: { message: "must be unique" } } } }, false],
    ["a field message without a duplicate marker", { response: { data: { slug: { message: "slug is invalid" } } } }, false],
    ["no error", null, false],
  ])("classifies %s", (_name, error, expected) => {
    expect(isDuplicateFieldError(error, "slug")).toBe(expected);
  });
});

describe("normalizeSpeakerProfileUpdateInput photo and text handling", () => {
  const base = { display_name: "  Host ", slug: " host " };

  it("requires a file for a photo replacement", () => {
    expect(normalizeSpeakerProfileUpdateInput({ ...base, photo: { intent: "replace", file: { name: "a.png", type: "image/png", data: [] } } }))
      .toEqual({ success: false, error: "Choose a photo to upload." });
  });

  it("validates a replacement photo type", () => {
    expect(normalizeSpeakerProfileUpdateInput({ ...base, photo: { intent: "replace", file: { name: "a.gif", type: "image/gif", data: [1] } } }))
      .toEqual({ success: false, error: "Photo must be JPEG, PNG, or WebP." });
  });

  it("trims text fields and defaults the photo intent", () => {
    expect(normalizeSpeakerProfileUpdateInput({ ...base, affiliation: " Org ", bio: undefined })).toEqual({
      success: true,
      data: {
        fields: { display_name: "Host", slug: "host", affiliation: "Org", bio: "", social_handles: [] },
        photo: { intent: "keep" },
      },
    });
  });

  it("rejects a blank display name and an invalid slug", () => {
    expect(normalizeSpeakerProfileUpdateInput({ display_name: " ", slug: "host" }))
      .toEqual({ success: false, error: "Display name is required." });
    expect(normalizeSpeakerProfileUpdateInput({ display_name: "Host", slug: "Bad Slug" }))
      .toEqual({ success: false, error: "Slug must use lowercase letters, numbers, and single hyphens only." });
  });
});

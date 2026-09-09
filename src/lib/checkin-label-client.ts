import type { CheckinApproveLabelProfile, CheckinConfigureLabelProfile, CheckinLabelProfileList, CheckinLabelProfileResult } from "~/lib/checkin-label-profile-contract";
import type { LabelProfile, LabelProfileConfig, LabelRasterResult } from "~/lib/checkin-label-render-contract";
import { labelCatalogueSchema, labelProfileConfigSchema, labelProfileResultSchema, labelRasterResultSchema } from "~/lib/checkin-label-validation";

export type LabelProfileStation = CheckinLabelProfileList["stations"][number];
export interface CheckinLabelCatalogue extends CheckinLabelProfileList {
  syntheticConfig: LabelProfileConfig;
}
export type LabelProfileMutation = { operation: "configure"; command: CheckinConfigureLabelProfile } | { operation: "approve"; command: CheckinApproveLabelProfile };

export class CheckinLabelRequestError extends Error {
  constructor(message: string, readonly ambiguous: boolean) { super(message); this.name = "CheckinLabelRequestError"; }
}
async function request<T>(body: object, parse: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/checkin-labels", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", referrerPolicy: "no-referrer" });
  } catch { throw new CheckinLabelRequestError("Name Label service could not be reached. A submitted profile change may have been saved; retry the same command.", true); }
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new CheckinLabelRequestError("Name Label response was unreadable. A submitted profile change may have been saved; retry the same command.", true); }
  if (!response.ok) {
    const failure = result as { error?: unknown };
    throw new CheckinLabelRequestError(typeof failure?.error === "string" ? failure.error : "Name Label service unavailable. Retry explicitly.", response.status >= 500 || response.status === 408);
  }
  try { return parse(result); }
  catch { throw new CheckinLabelRequestError("Name Label success response was malformed or did not match the submitted command. Its outcome is unknown; retry the same command.", true); }
}
export const listLabelProfiles = () => request<CheckinLabelCatalogue>({ operation: "list" }, (value) => labelCatalogueSchema.parse(value));
export function mutateLabelProfile(mutation: LabelProfileMutation): Promise<CheckinLabelProfileResult> {
  const submitted = structuredClone(mutation);
  return request(submitted, (value) => {
    const result = labelProfileResultSchema.parse(value);
    const profile = result.profile;
    if (submitted.operation === "configure") {
      if (profile.stationId !== submitted.command.stationId || profile.version !== submitted.command.expectedVersion + 1 || profile.approval !== "unapproved" || JSON.stringify(profile.config) !== JSON.stringify(labelProfileConfigSchema.parse(submitted.command.config))) throw new Error("Mismatched profile result");
    } else if (profile.id !== submitted.command.profileId || profile.version !== submitted.command.expectedVersion || profile.approval !== "approved" || profile.config.synthetic) throw new Error("Mismatched approval result");
    return result;
  });
}
export function previewNameLabel(text: { name: string; affiliation: string }, profile?: LabelProfile): Promise<LabelRasterResult> {
  const submittedText = { ...text };
  const submittedProfile = profile ? structuredClone(profile) : undefined;
  return request(submittedProfile ? { operation: "preview", profileId: submittedProfile.id, expectedVersion: submittedProfile.version, text: submittedText } : { operation: "preview_synthetic", text: submittedText }, (value) => {
    const result = labelRasterResultSchema.parse(value);
    if (result.snapshot.text.name !== submittedText.name || result.snapshot.text.affiliation !== submittedText.affiliation) throw new Error("Mismatched preview text");
    if (submittedProfile) {
      const returned = result.snapshot.profile;
      if (returned.id !== submittedProfile.id || returned.version !== submittedProfile.version || returned.stationId !== submittedProfile.stationId || JSON.stringify(returned.config) !== JSON.stringify(labelProfileConfigSchema.parse(submittedProfile.config))) throw new Error("Mismatched preview profile");
    } else if (!result.snapshot.profile.config.synthetic || result.snapshot.profile.approval !== "unapproved") throw new Error("Mismatched synthetic preview");
    return result;
  });
}

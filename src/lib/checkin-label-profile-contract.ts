import type { CheckinReasonCode } from "~/lib/checkin-contract";
import type { LabelProfile, LabelProfileConfig } from "~/lib/checkin-label-render-contract";
export type { LabelProfile, LabelProfileConfig } from "~/lib/checkin-label-render-contract";

export interface CheckinLabelProfileList {
  /** Only the latest configuration per station; older versions remain previewable by exact ID. */
  profiles: LabelProfile[];
  /** Original immutable station fence for the listed profile versions. */
  profileStationVersions: Record<string, number>;
  stations: { id: string; label: string; printerRef: string; version: number }[];
  operationsEnabled: false;
}
interface CheckinLabelProfileCommand {
  /** Freeze the complete command across retries; use a new UUID for new intent. */
  operationId: string;
  expectedVersion: number;
  expectedStationVersion: number;
  reason: CheckinReasonCode;
  /** Bounded non-sensitive operational context; never attendee text or capabilities. */
  note: string;
}
export interface CheckinConfigureLabelProfile extends CheckinLabelProfileCommand {
  stationId: string;
  /** Explicit dot geometry: nominal millimetres never imply calibration. */
  config: LabelProfileConfig;
}
export interface CheckinApproveLabelProfile extends CheckinLabelProfileCommand {
  profileId: string;
  /** Human attestation of physical legibility/feed/bounds on this exact printer/stock/version.
   * A preview, raster hash or generic-stock compatibility report is not evidence. */
  physicalConfirmation: true;
}
export interface CheckinLabelProfileResult {
  actionId: string;
  replayed: boolean;
  profile: LabelProfile;
}
export interface CheckinLabelProfileServiceContract {
  list(): Promise<CheckinLabelProfileList>;
  configure(command: CheckinConfigureLabelProfile): Promise<CheckinLabelProfileResult>;
  approve(command: CheckinApproveLabelProfile): Promise<CheckinLabelProfileResult>;
  /** Historical exact configuration for admin preview only; not print authorization.
   * Approval is effective only for the latest profile at its original station version. */
  get(profileId: string): Promise<LabelProfile>;
}

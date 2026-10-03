import type { FieldIssue } from "./cfp-model.ts";

export interface CentralProfileV1 {
  version: 1;
  wtsUserId: string;
  name: string;
  avatarUrl: string | null;
  preferredLanguage: string | null;
  username: string;
  emailVisibility: boolean;
  revision: number;
}

export interface VerifiedCfpAccount {
  wtsUserId: string;
  email: string;
  emailVerified: true;
  profile: CentralProfileV1;
  accountUrl: string;
}

export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; issues: FieldIssue[] } };

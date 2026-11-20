// Type bridge for "~/lib/account-model". site and cfp both own a file at that path,
// and tsconfig paths cannot choose by importer. vite.config.ts resolves the real files.
export type { ActionResult, CentralProfileV1, VerifiedCfpAccount } from "../../../cfp/src/lib/account-model";
export type { AccountSession } from "../../../site/src/lib/account-model";

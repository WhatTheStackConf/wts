import { getRequestEvent } from "@solidjs/web";
import { ZodError } from "zod";
import { assertMutationRequest, readAccount, requireAccount } from "../server/cfp-sessions.ts";
import * as staff from "../server/staff.ts";
import type { ActionResult, VerifiedCfpAccount } from "./account-model.ts";
import { StaffError, type AdminProposal, type AdminQuery, type AdminWorkspace, type ReviewerProposal, type ReviewerWorkspace, type StaffAccess, type StaffCommand, type StaffDirectory, type StaffMutationReceipt } from "./staff-model.ts";

function privateRequest(): Request {
  const event = getRequestEvent();
  if (!event) throw new Error("The staff request is unavailable.");
  event.response.headers.set("Cache-Control", "private, no-store");
  return event.request;
}
async function result<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try { return { ok: true, value: await run() }; }
  catch (error) {
    if (error instanceof StaffError) return { ok: false, error: { code: error.code, message: error.message, issues: error.issues ?? [] } };
    if (error instanceof ZodError) return { ok: false, error: { code: "invalid_fields", message: "Check the supplied fields.", issues: error.issues.map((issue) => ({ field: issue.path.join("."), message: "This field is invalid." })) } };
    if (error instanceof Response) {
      const denied = error.status === 403 || error.status === 405;
      return { ok: false, error: { code: error.status === 401 ? "unauthenticated" : denied ? "forbidden" : "unavailable", message: error.status === 401 ? "Sign in to access CFP staff data." : denied ? "The request is not permitted." : "The identity service could not verify this account.", issues: [] } };
    }
    return { ok: false, error: { code: "unavailable", message: "The application could not complete this request. Try again later.", issues: [] } };
  }
}
export async function getNavigation(): Promise<{ account: VerifiedCfpAccount; access: StaffAccess } | null> {
  "use server";
  const request = privateRequest();
  try { const account = await readAccount(request); return account ? { account, access: staff.getStaffAccess(account) } : null; }
  catch (error) { if (error instanceof Response) throw error; throw new Response("The application could not verify this account.", { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
}
export async function getStaffAccess(): Promise<ActionResult<StaffAccess>> {
  "use server";
  const request = privateRequest(); return result(async () => staff.getStaffAccess(await requireAccount(request)));
}
export async function getReviewerWorkspace(): Promise<ActionResult<ReviewerWorkspace>> {
  "use server";
  const request = privateRequest(); return result(async () => staff.getReviewerWorkspace(await requireAccount(request)));
}
export async function getReviewerProposal(applicationId: string): Promise<ActionResult<ReviewerProposal>> {
  "use server";
  const request = privateRequest(); return result(async () => staff.getReviewerProposal(await requireAccount(request), applicationId));
}
export async function getNextReview(query?: { excludeApplicationId?: string }): Promise<ActionResult<{ applicationId: string } | null>> {
  "use server";
  const request = privateRequest(); return result(async () => staff.getNextReview(await requireAccount(request), query));
}
export async function getAdminWorkspace(query?: AdminQuery): Promise<ActionResult<AdminWorkspace>> {
  "use server";
  const request = privateRequest(); return result(async () => staff.getAdminWorkspace(await requireAccount(request), query));
}
export async function getAdminProposal(applicationId: string): Promise<ActionResult<AdminProposal>> {
  "use server";
  const request = privateRequest(); return result(async () => staff.getAdminProposal(await requireAccount(request), applicationId));
}
export async function getStaffDirectory(): Promise<ActionResult<StaffDirectory>> {
  "use server";
  const request = privateRequest(); return result(async () => staff.getStaffDirectory(await requireAccount(request)));
}
export async function executeStaffCommand<C extends StaffCommand>(command: C): Promise<ActionResult<StaffMutationReceipt<C["kind"]>>> {
  "use server";
  const request = privateRequest(); return result(async () => { assertMutationRequest(request); const account = await requireAccount(request); return staff.executeStaffCommand(account, command); });
}

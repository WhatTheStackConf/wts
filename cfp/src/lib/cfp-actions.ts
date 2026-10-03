import { getRequestEvent } from "@solidjs/web";
import { ZodError } from "zod";
import { CfpError, applicantChangeSchema, idSchema, saveDraftSchema, startDraftSchema, submitDraftSchema } from "./cfp-model.ts";
import { assertMutationRequest, readAccount, requireAccount } from "../server/cfp-sessions.ts";
import * as applicants from "../server/applicants.ts";
import type { ActionResult, VerifiedCfpAccount } from "./account-model.ts";
import type {
  ApplicantChange, ApplicantView, ApplicationView, DraftView, SaveDraftCommand,
  StartDraftCommand, SubmitDraftCommand, SubmissionReceipt, Workspace,
} from "./cfp-model.ts";

function privateRequest(): Request {
  const event = getRequestEvent();
  if (!event) throw new Error("The applicant request is unavailable.");
  event.response.headers.set("Cache-Control", "private, no-store");
  return event.request;
}

async function result<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof CfpError) {
      return { ok: false, error: { code: error.code, message: error.message, issues: error.issues ?? [] } };
    }
    if (error instanceof ZodError) {
      return { ok: false, error: {
        code: "invalid_fields", message: "Check the supplied fields.",
        issues: error.issues.map((issue) => ({ field: issue.path.join("."), message: "This field is invalid." })),
      } };
    }
    if (error instanceof Response) {
      const denied = error.status === 403 || error.status === 405;
      return { ok: false, error: {
        code: error.status === 401 ? "unauthenticated" : denied ? "forbidden" : "unavailable",
        message: error.status === 401 ? "Sign in to access your applicant data." : denied ? "The request is not permitted." : "The identity service could not verify this account.",
        issues: [],
      } };
    }
    return { ok: false, error: { code: "unavailable", message: "The application could not complete this request. Try again later.", issues: [] } };
  }
}

export async function getAccount(): Promise<VerifiedCfpAccount | null> {
  "use server";
  const request = privateRequest();
  try {
    return await readAccount(request);
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response("The application could not verify this account.", { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function getCfpStatus(): Promise<{ editionId: string; cfpOpen: boolean }> {
  "use server";
  privateRequest();
  try {
    return applicants.getCfpStatus();
  } catch {
    throw new Response("The application status is unavailable.", { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function getWorkspace(): Promise<ActionResult<Workspace>> {
  "use server";
  const request = privateRequest();
  return result(async () => {
    const account = await requireAccount(request);
    return applicants.getWorkspace(account);
  });
}

export async function getApplication(id: string): Promise<ActionResult<ApplicationView>> {
  "use server";
  const request = privateRequest();
  return result(async () => {
    const account = await requireAccount(request);
    const applicationId = idSchema.parse(id);
    return applicants.getApplication(account, applicationId);
  });
}

export async function getDraft(id: string): Promise<ActionResult<DraftView>> {
  "use server";
  const request = privateRequest();
  return result(async () => {
    const account = await requireAccount(request);
    const draftId = idSchema.parse(id);
    return applicants.getDraft(account, draftId);
  });
}

export async function startDraft(command: StartDraftCommand): Promise<ActionResult<DraftView>> {
  "use server";
  const request = privateRequest();
  return result(async () => {
    assertMutationRequest(request);
    const account = await requireAccount(request);
    const parsed = startDraftSchema.parse(command);
    return applicants.startDraft(account, parsed);
  });
}

export async function saveApplicant(command: ApplicantChange): Promise<ActionResult<ApplicantView>> {
  "use server";
  const request = privateRequest();
  return result(async () => {
    assertMutationRequest(request);
    const account = await requireAccount(request);
    const parsed = applicantChangeSchema.parse(command);
    return applicants.saveApplicant(account, parsed);
  });
}

export async function saveDraft(command: SaveDraftCommand): Promise<ActionResult<DraftView>> {
  "use server";
  const request = privateRequest();
  return result(async () => {
    assertMutationRequest(request);
    const account = await requireAccount(request);
    const parsed = saveDraftSchema.parse(command);
    return applicants.saveDraft(account, parsed);
  });
}

export async function submitDraft(command: SubmitDraftCommand): Promise<ActionResult<SubmissionReceipt>> {
  "use server";
  const request = privateRequest();
  return result(async () => {
    assertMutationRequest(request);
    const account = await requireAccount(request);
    const parsed = submitDraftSchema.parse(command);
    return applicants.submitDraft(account, parsed);
  });
}

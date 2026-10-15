import { ZodError } from "zod";
import type { ActionResult } from "./account-model.ts";
import type { FieldIssue } from "./cfp-model.ts";

type ActionFailure = Extract<ActionResult<never>, { ok: false }>["error"];
interface DomainError { code: string; message: string; issues?: FieldIssue[] }
type DomainErrorClass = abstract new (...args: never[]) => DomainError;

function responseFailure(status: number, signInMessage: string): ActionFailure {
  if (status === 401) return { code: "unauthenticated", message: signInMessage, issues: [] };
  if (status === 403 || status === 405) return { code: "forbidden", message: "The request is not permitted.", issues: [] };
  return { code: "unavailable", message: "The identity service could not verify this account.", issues: [] };
}

function failure(error: unknown, domainError: DomainErrorClass, signInMessage: string): ActionFailure {
  if (error instanceof domainError) return { code: error.code, message: error.message, issues: error.issues ?? [] };
  if (error instanceof ZodError) {
    return { code: "invalid_fields", message: "Check the supplied fields.", issues: error.issues.map((issue) => ({ field: issue.path.join("."), message: "This field is invalid." })) };
  }
  if (error instanceof Response) return responseFailure(error.status, signInMessage);
  return { code: "unavailable", message: "The application could not complete this request. Try again later.", issues: [] };
}

export async function actionResult<T>(run: () => Promise<T>, domainError: DomainErrorClass, signInMessage: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: failure(error, domainError, signInMessage) };
  }
}

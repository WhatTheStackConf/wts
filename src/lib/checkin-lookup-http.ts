import { z } from "zod";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import { checkinLookupSearchInputSchema, checkinLookupConfirmInputSchema, type CheckinLookupSearchInput, type CheckinLookupSearchResult, type CheckinLookupConfirmInput } from "~/lib/checkin-lookup-contract";
import { parseCheckinLookupSearchResult, parseCheckinLookupConfirmResult } from "~/lib/checkin-lookup-client";
import { checkinLookupRecoverInputSchema, checkinLookupRecoveryOperationIdSchema, type CheckinLookupRecoveryServiceContract } from "~/lib/checkin-lookup-recovery-contract";
import { parseCheckinLookupRecovery } from "~/lib/checkin-lookup-recovery-validation";
export interface CheckinLookupServiceContract extends CheckinLookupRecoveryServiceContract {
  search(bindingToken: string | undefined, input: CheckinLookupSearchInput): Promise<CheckinLookupSearchResult>;
  confirm(bindingToken: string | undefined, input: CheckinLookupConfirmInput): Promise<CheckinArrivalResult>;
}
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";



const schema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("confirm"), input: checkinLookupConfirmInputSchema }),
  z.strictObject({ operation: z.literal("search"), input: checkinLookupSearchInputSchema }),
  z.strictObject({ operation: z.literal("recovery_get"), input: z.strictObject({ operationId: checkinLookupRecoveryOperationIdSchema }) }),
  z.strictObject({ operation: z.literal("recover"), input: checkinLookupRecoverInputSchema }),
]);
interface Actor { id: string; role: string }
export interface CheckinLookupHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<CheckinLookupServiceContract>;
}
function response(body: unknown, status = 200) {
  return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
export async function handleCheckinLookupRequest(request: Request, deps: CheckinLookupHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Check-in access denied." }, 403);
  let actor: Actor;
  try {
    actor = await deps.authenticate();
    if (!actor.id || !["admin", "checkin_operator"].includes(actor.role)) return response({ error: "Check-in access denied." }, 403);
  } catch { return response({ error: "Check-in access denied." }, 403); }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return response({ error: "Use a JSON lookup command." }, 415);
  let command: z.infer<typeof schema>;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = request.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8192) { void reader.cancel().catch(() => undefined); return response({ error: "Lookup command too large." }, 413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    command = schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return response({ error: "Invalid lookup command." }, 400); }
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith("wts_checkin_client="));
  const token = cookies[0]?.slice("wts_checkin_client=".length);
  if (cookies.length !== 1 || !token || !/^[a-f0-9]{64}$/.test(token)) return response({ error: "Invalid station client identity." }, 403);
  try {
    const service = await deps.service(actor);
    if (command.operation === "confirm") return response(parseCheckinLookupConfirmResult(await service.confirm(token, command.input), command.input));
    if (command.operation === "recovery_get") return response(parseCheckinLookupRecovery(await service.getRecovery(token, command.input.operationId), command.input.operationId));
    if (command.operation === "recover") {
      const original = parseCheckinLookupRecovery(await service.getRecovery(token, command.input.operationId), command.input.operationId);
      const expected = { context: original.context, operationId: command.input.action === "replay" ? command.input.operationId : command.input.nextOperationId };
      return response(parseCheckinLookupConfirmResult(await service.recover(token, command.input), expected));
    }
    return response(parseCheckinLookupSearchResult(await service.search(token, command.input), command.input));
  } catch (error) {
    // Reconstruct even known errors: do not trust a mutable Error.message.
    if (error instanceof CheckinError) return response({ code: error.code, error: new CheckinError(error.code, error.status).message }, error.status);
    return response({ error: "Lookup service unavailable. A confirmation may have been saved; retry the same command." }, 503);
  }
}

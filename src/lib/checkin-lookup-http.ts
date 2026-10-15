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
import { authenticateCheckinActor, checkinClientCookies, readCheckinCommand } from "~/lib/checkin-http-request";



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
type Command = z.infer<typeof schema>;
type Operation<K extends Command["operation"]> = (service: CheckinLookupServiceContract, token: string, input: Extract<Command, { operation: K }>["input"]) => Promise<unknown>;
const operations: { [K in Command["operation"]]: Operation<K> } = {
  confirm: async (service, token, input) => parseCheckinLookupConfirmResult(await service.confirm(token, input), input),
  recovery_get: async (service, token, input) => parseCheckinLookupRecovery(await service.getRecovery(token, input.operationId), input.operationId),
  recover: async (service, token, input) => {
    const original = parseCheckinLookupRecovery(await service.getRecovery(token, input.operationId), input.operationId);
    const expected = { context: original.context, operationId: input.action === "replay" ? input.operationId : input.nextOperationId };
    return parseCheckinLookupConfirmResult(await service.recover(token, input), expected);
  },
  search: async (service, token, input) => parseCheckinLookupSearchResult(await service.search(token, input), input),
};
const REJECTIONS = { 413: "Lookup command too large.", 400: "Invalid lookup command." } as const;
function stationToken(request: Request): string | null {
  const tokens = checkinClientCookies(request);
  return tokens.length === 1 && /^[a-f0-9]{64}$/.test(tokens[0]) ? tokens[0] : null;
}
export async function handleCheckinLookupRequest(request: Request, deps: CheckinLookupHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Check-in access denied." }, 403);
  const actor = await authenticateCheckinActor(() => deps.authenticate(), (candidate) => !!candidate.id && ["admin", "checkin_operator"].includes(candidate.role));
  if (!actor) return response({ error: "Check-in access denied." }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return response({ error: "Use a JSON lookup command." }, 415);
  const read = await readCheckinCommand(request, 8192, (value) => schema.parse(value));
  if (!read.ok) return response({ error: REJECTIONS[read.status] }, read.status);
  const token = stationToken(request);
  if (!token) return response({ error: "Invalid station client identity." }, 403);
  try {
    const service = await deps.service(actor);
    const run = operations[read.command.operation] as Operation<Command["operation"]>;
    return response(await run(service, token, read.command.input));
  } catch (error) {
    // Reconstruct even known errors: do not trust a mutable Error.message.
    if (error instanceof CheckinError) return response({ code: error.code, error: new CheckinError(error.code, error.status).message }, error.status);
    return response({ error: "Lookup service unavailable. A confirmation may have been saved; retry the same command." }, 503);
  }
}

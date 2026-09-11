import { z } from "zod";
import type { LabelProfile } from "./checkin-label-render-contract.js";
const id=z.string().regex(/^[a-z0-9]{15}$/);
const text=z.string().max(200).refine(v=>!/[\x00-\x1f\x7f<>@]|:\/\/|www\.|[a-f0-9]{64}|bearer|password|secret|token\s*[:=]|\/dev\/|\b[A-Z]-[A-Z0-9]{7}\b/i.test(v));
const base={operationId:z.uuid(),workflowId:id,expectedVersion:z.number().int().min(0)};
const truth={...base,reason:z.enum(["incident","erroneous_checkin","duplicate","wrong_attendee"]),note:text.max(240)};
export const recoveryCommandSchema=z.discriminatedUnion("operation",[
 z.strictObject({...truth,operation:z.literal("authorize_initial"),readId:id}),
 z.strictObject({...truth,operation:z.literal("reset"),readId:id,checkinId:z.string().regex(/^[1-9][0-9]{0,15}$/),confirmed:z.literal(true),producersQuiescent:z.literal(true)}),
 ...(["deny","cancel","continue"] as const).map(operation=>z.strictObject({...truth,operation:z.literal(operation)})),
 z.strictObject({...base,operation:z.literal("correct"),name:text.min(1),affiliation:text}),
 z.strictObject({...base,operation:z.literal("observe"),printId:id,outcome:z.enum(["printed","not_printed"])}),
 z.strictObject({...base,operation:z.literal("replace"),printId:id}),
 z.strictObject({...base,operation:z.literal("handwrite"),physicallyIsolated:z.boolean()}),
 z.strictObject({...base,operation:z.literal("release_isolation"),confirmed:z.literal(true)}),
 ...(["park","resume","retry_admission_reads"] as const).map(operation=>z.strictObject({...base,operation:z.literal(operation)})),
]);
export type RecoveryCommand=z.infer<typeof recoveryCommandSchema>;
export interface RecoveryTarget {workflowId:string;sourceKey:string;upstreamEventId:string;upstreamListId:string;upstreamAttendeeId:string}
export type RecoveryRead={state:"absent"|"malformed"|"unavailable"}|{state:"existing";checkinId:string;fingerprint:string};
export interface RecoveryReadResult {id:string;state:RecoveryRead["state"];checkinId:string}
export interface RecoverySource {reconcile(target:RecoveryTarget):Promise<RecoveryRead>}
export interface RecoveryWorkflow {
 workflowId:string;stationId:string;eventId:string;eventTitle:string;admissionState:string;version:number;name:string;affiliation:string;decision:string;fulfillment:string;parked:boolean;completedDay:string;isolated:boolean;profile:LabelProfile;
 attemptsTruncated?:boolean;
 attempts:{id:string;purpose:string;state:string;name:string;affiliation:string;predecessorId:string;observation:string|null;cancellation:string|null}[];
 reads:{id:string;state:string;checkinId:string;createdAt:string}[];
 admissionAttempts:{id:string;state:string;listId:string;attendeeId:string;sendBoundaryAt:string;completedAt:string;fingerprint:string}[];
 resets:{id:string;state:string;checkinId:string;sendBoundaryAt:string}[];
 /** Owning-station, lifecycle and durable pre-send exhaustion eligibility. */
 admissionReadRetryEligible:boolean;
 operationsEnabled:false;
}
export interface RecoveryResult {
 operationId:string;workflow:RecoveryWorkflow;
 replayed?:boolean;commandId?:string;commandVersion?:number;
 commandOutcome?:{decision:string;fulfillment:string;printId?:string};
}

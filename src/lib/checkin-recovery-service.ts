import type PocketBase from "pocketbase";
import type { CheckinActor } from "./checkin-contract";
import { CheckinError } from "./checkin-service";
import { checkinEventBindingHash } from "./checkin-event-service";
import { recoveryCommandSchema, type RecoveryCommand, type RecoverySource, type RecoveryTarget, type RecoveryReadResult, type RecoveryWorkflow, type RecoveryResult } from "./checkin-recovery-contract";
import { renderNameLabel } from "./checkin-label-renderer";
export class CheckinRecoveryService {
 constructor(private pb:PocketBase,private actor:CheckinActor,private source:RecoverySource){}
 private async request<T>(operation:string,body:object):Promise<T>{
  if(!this.actor?.userId||!["admin","checkin_operator"].includes(this.actor.role))throw new CheckinError("forbidden",403);
  try{return await this.pb.send<T>("/api/wts/checkin-recovery",{method:"POST",body:{...body,operation,actorUserId:this.actor.userId},requestKey:null});}
  catch(error){const s=(error as {status?:number}).status;throw new CheckinError(s===403?"forbidden":s===409?"conflict":s===400?"invalid_input":"unavailable",s===403?403:s===409?409:s===400?400:503);}
 }
 private binding(token?:string){return token?checkinEventBindingHash(token):"";}
 get(token:string|undefined,workflowId:string){return this.request<RecoveryWorkflow>("get",{identityHash:this.binding(token),workflowId});}
 history(token?:string,offset=0){return this.request<{items:RecoveryWorkflow[];nextOffset:number|null}>("history",{identityHash:this.binding(token),offset});}
 attemptHistory(token:string|undefined,workflowId:string,offset=0){if(!Number.isSafeInteger(offset)||offset<0)throw new CheckinError("invalid_input",400);return this.request<{workflowId:string;items:RecoveryWorkflow["attempts"];nextOffset:number|null}>("attempt_history",{identityHash:this.binding(token),workflowId,offset});}
 async reconcile(workflowId:string):Promise<RecoveryReadResult>{
  const target=await this.request<RecoveryTarget>("reconcile_context",{workflowId});
  let outcome;try{outcome=await this.source.reconcile(target);}catch{outcome={state:"unavailable"};}
  return this.request("reconcile_record",{workflowId,outcome});
 }
 command(token:string|undefined,input:RecoveryCommand):Promise<RecoveryResult>{const c=recoveryCommandSchema.safeParse(input);if(!c.success)throw new CheckinError("invalid_input",400);return this.request("command",{identityHash:this.binding(token),command:c.data});}
 async preview(token:string|undefined,workflowId:string,name:string,affiliation:string){
  recoveryCommandSchema.parse({operation:"correct",operationId:crypto.randomUUID(),workflowId,expectedVersion:0,name,affiliation});
  const w=await this.get(token,workflowId),p=w.profile;
  const raster=await renderNameLabel({text:{name,affiliation},profile:p,mode:"preview",expected:{profileId:p.id,profileVersion:p.version,printerRef:p.config.printerRef,stockRef:p.config.stockRef,rendererVersion:p.config.rendererVersion,fontVersion:p.config.fontVersion}});
  // Revalidate binding/role after asynchronous rendering before returning text.
  await this.get(token,workflowId);
  return {workflowId,name,affiliation,pngBase64:raster.pngBase64,rows:raster.rows,width:raster.width,height:raster.height};
 }
}

import { createHash, randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import type { AgentActor, AgentIssueCommand, AgentRevokeCommand, AgentControlResult, AgentAdminListDTO, AgentReadinessDTO, CheckinAgentServiceContract } from "~/lib/checkin-agent-contract";
import { CheckinError } from "~/lib/checkin-service";
import { checkinHookError } from "~/lib/checkin-hook-error";
export class CheckinAgentService implements CheckinAgentServiceContract {
  constructor(private readonly pb: PocketBase, private readonly actor: AgentActor) {}
  private async request<T>(operation: string, data: object = {}): Promise<T> {
    if (!this.actor?.userId || !["admin", "checkin_operator"].includes(this.actor.role) || (operation !== "status" && this.actor.role !== "admin")) throw new CheckinError("forbidden", 403);
    try { return await this.pb.send<T>("/api/wts/checkin-agents", { method: "POST", body: { ...data, operation, actorUserId: this.actor.userId }, requestKey: null }); }
    catch (error) { throw checkinHookError(error, ["forbidden", "invalid_input", "conflict"]); }
  }
  status(bindingToken?: string | null): Promise<{ station: AgentReadinessDTO | null }> {
    if (bindingToken && !/^[a-f0-9]{64}$/.test(bindingToken)) throw new CheckinError("invalid_binding", 400);
    return this.request("status", { identityHash: bindingToken ? createHash("sha256").update(`wts2026:binding:${bindingToken}`).digest("hex") : "" });
  }
  adminList(): Promise<AgentAdminListDTO> { return this.request("admin_list"); }
  async issue(command: AgentIssueCommand): Promise<AgentControlResult> {
    const credential = `wts_agent_${randomBytes(32).toString("hex")}`;
    const credentialHash = createHash("sha256").update(`wts2026:agent:${credential}`).digest("hex");
    const result = await this.request<AgentControlResult>("admin_issue", { command, credentialHash });
    return result.replayed ? result : { ...result, credential };
  }
  revoke(command: AgentRevokeCommand): Promise<AgentControlResult> { return this.request("admin_revoke", { command }); }
}

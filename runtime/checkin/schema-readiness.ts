import type PocketBase from "pocketbase";
import { AgentError } from "./protocol.js";

/** Required runtime metadata, including reset fences and fulfillment evidence. */
export const REQUIRED_CHECKIN_FIELDS: Record<string, Record<string, string>> = {
  checkin_arrival_workflows: { profile_snapshot: "json" },
  checkin_print_attempts: { profile_snapshot: "json", fulfillment_completed_at: "text" },
  checkin_arrival_attempts: { claim_owner_hash: "text", outcome_digest: "text" },
  checkin_recovery_resets: { claim_system_generation: "number", send_claim_target: "json", delete_fence_at: "text" },
  checkin_lookup_commands: { context: "json", snapshot: "json" },
  checkin_monitoring_config: { observation_sequence: "number", applied_observation_sequence: "number", recipient_user_ids: "json" },
  checkin_lifecycle: { closed_at: "text", purge_deadline: "text", restore_required: "bool" },
};
export async function verifyCheckinSchema(pb: PocketBase): Promise<void> {
  try {
    for (const [name, fields] of Object.entries(REQUIRED_CHECKIN_FIELDS)) {
      const collection = await pb.collections.getOne(name, { requestKey: null });
      for (const [key, type] of Object.entries(fields)) {
        const field = collection.fields.find(field => field.name === key);
        if (!field || field.type !== type || key === "profile_snapshot" && Number(field.maxSize) < 16384) throw new Error();
      }
    }
  } catch { throw new AgentError("schema_incompatible"); }
}

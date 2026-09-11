import { createCheckinRecoveryPOST } from "~/lib/checkin-recovery-server";
import { createCheckinRecoverySource } from "~/lib/checkin-recovery-upstream";

// Session and role are verified server-side; binding is enforced by the service.
export const POST = createCheckinRecoveryPOST(createCheckinRecoverySource());

import { renderToString } from "@solidjs/web";
import { expect, it } from "vite-plus/test";
import { CheckinAdminRecovery, CheckinOperatorRecovery } from "./CheckinRecovery";
it("redacts unavailable/unbound shells and never renders admin controls for an operator", () => {
  expect(renderToString(() => <CheckinOperatorRecovery />)).not.toContain("Station label recovery");
  expect(renderToString(() => <CheckinOperatorRecovery scopeKey="actor:binding-v1" unavailable />)).not.toContain("Recover a label");
  const operator = renderToString(() => <CheckinOperatorRecovery scopeKey="actor:binding-v1" />);
  expect(operator).toContain("Recover a label at this station"); expect(operator).not.toContain("Guarded erroneous-check-in reset");
  const admin = renderToString(() => <CheckinAdminRecovery scopeKey="admin:session-v1" />);
  expect(admin).toContain("Admission evidence and recovery"); expect(admin).not.toMatch(/force.new.checkin|transfer station|bindingToken|@example/);
});

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
it("compact recovery starts with recent work, not a recovery manual", () => {
  const html = renderToString(() => <CheckinOperatorRecovery scopeKey="operator:binding" compact />);
  expect(html).toContain("Recent work");
  expect(html).not.toContain("Parking does not make uncertain printing safe");
  expect(html).not.toContain("Guarded erroneous-check-in reset");
  expect(html).not.toContain("Label-only name");
});
it("unavailable compact recovery never exposes selected work", () => {
  const html = renderToString(() => <CheckinOperatorRecovery scopeKey="operator:binding" compact unavailable />);
  expect(html).not.toContain("Label-only name");
  expect(html).not.toContain("Request a new replacement label");
});

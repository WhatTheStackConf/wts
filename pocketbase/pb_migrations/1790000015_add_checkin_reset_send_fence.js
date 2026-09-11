/// <reference path="../pb_data/types.d.ts" />
migrate(app => {
  const resets = app.findCollectionByNameOrId("checkin_recovery_resets");
  resets.fields.add(new NumberField({ name: "claim_system_generation", min: 0, onlyInt: true }));
  resets.fields.add(new JSONField({ name: "send_claim_target", maxSize: 4096 }));
  resets.fields.add(new TextField({ name: "delete_fence_at", max: 40 }));
  app.save(resets);
  // Existing possibly_sent rows intentionally have no claim snapshot and cannot send.
  // Evidence stays on the reset row, covered by the existing lifecycle purge.
}, () => { throw new Error("Reset send evidence requires a forward lifecycle migration."); });

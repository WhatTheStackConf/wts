/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const text = (name, max = 80, required = false) => ({ name, type: "text", max, required });
  const bool = (name) => ({ name, type: "bool" });
  const number = (name) => ({ name, type: "number", min: 0, onlyInt: true });
  function collection(name, fields, indexes = []) {
    const c = new Collection({ name, type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields });
    for (const [index, unique, columns] of indexes) c.addIndex(index, unique, columns, "");
    app.save(c); return c;
  }
  const lifecycle = collection("checkin_lifecycle", [text("edition", 12, true), text("closed_at", 40), text("purge_deadline", 40), text("central_deleted_at", 40), text("central_compacted_at", 40), number("workflow_total"), number("print_total"), bool("boot_seen"), bool("restore_required"), number("restore_generation"), text("reconciled_at", 40), text("reconciliation_digest", 64), text("approved_at", 40)]);
  const state = new Record(lifecycle); state.set("id", "wts2026life0000"); state.set("edition", "WTS2026"); app.save(state);
  collection("checkin_lifecycle_devices", [text("station_id", 15, true), text("journal_identity", 80), text("purge_token", 64, true), text("completed_at", 40), text("method", 24), text("last_seen_at", 40)], [["idx_lifecycle_device", true, "station_id,journal_identity"]]);
  collection("checkin_lifecycle_audit", [text("operation", 32, true), text("actor_user_id", 15), text("operation_id", 36), text("at", 40, true), number("generation")]);
}, () => { throw new Error("Lifecycle closure and retirement are irreversible; use a forward migration."); });

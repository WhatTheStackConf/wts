/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const attempts = app.findCollectionByNameOrId("checkin_agent_attempts");
  attempts.fields.add(new TextField({ name: "print_attempt_id", max: 15 }));
  attempts.fields.add(new SelectField({ name: "purpose", values: ["generic", "initial"], maxSelect: 1 }));
  attempts.fields.add(new JSONField({ name: "payload", maxSize: 32768 }));
  app.save(attempts);
}, (app) => {
  if (app.countRecords("checkin_agent_attempts")) throw new Error("Agent attempt history exists; use a forward migration.");
  const attempts = app.findCollectionByNameOrId("checkin_agent_attempts");
  for (const field of ["print_attempt_id", "purpose", "payload"]) attempts.fields.removeByName(field);
  app.save(attempts);
});

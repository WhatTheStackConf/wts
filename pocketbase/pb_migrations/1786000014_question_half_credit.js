/// <reference path="../pb_data/types.d.ts" />
// Additive: the terminal outcome, not a caller-controlled multiplier, is retained.
migrate((app) => {
  const attempts = app.findCollectionByNameOrId("gamification_question_attempts");
  const status = attempts.fields.getByName("status");
  status.values = [...status.values, "passed_half"];
  app.save(attempts);
}, () => {
  throw new Error("Half-credit completion evidence is retained. Use a reviewed forward migration.");
});

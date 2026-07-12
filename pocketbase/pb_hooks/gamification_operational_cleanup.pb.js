/// <reference path="../pb_data/types.d.ts" />

cronAdd("gamification-expired-operational-state", "*/5 * * * *", () => {
  const cutoff = new Date().toISOString().replace("T", " ");
  for (const collection of ["gamification_operation_locks", "gamification_rate_limit_attempts"]) {
    try {
      const records = $app.findRecordsByFilter(
        collection,
        "expires_at <= {:cutoff}",
        "expires_at",
        5000,
        0,
        { cutoff },
      );
      for (const record of records) $app.delete(record);
    } catch {
      $app.logger().warn("Gamification operational cleanup deferred", "collection", collection);
    }
  }
});

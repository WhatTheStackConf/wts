/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    app.db().newQuery(
      "UPDATE users SET role = 'user' WHERE role = '' OR role IS NULL",
    ).execute();
  },
  () => {
    // Empty legacy roles cannot be distinguished after normalization.
  },
);

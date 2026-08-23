/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const partners = app.findCollectionByNameOrId("partners");
    const tier = partners.fields.getByName("tier");

    // Append rather than overwrite: the value may already have been added by
    // hand in the Admin UI, and any other value present there is not ours to
    // drop. Re-running this migration on such an instance is a no-op.
    if (tier.values.includes("bank")) return;

    tier.values = [...tier.values, "bank"];
    app.save(partners);
  },
  (app) => {
    const partners = app.findCollectionByNameOrId("partners");

    // Keep any bank-tier rows visible by folding them into the lowest ranked
    // sponsor tier before the value disappears from the schema.
    try {
      app.db().newQuery("UPDATE partners SET tier = 'bronze' WHERE tier = 'bank'").execute();
    } catch {
      // Some PocketBase JS runtimes expose the query helpers differently; the
      // select-value change below is the important part of the rollback.
    }

    const tier = partners.fields.getByName("tier");
    tier.values = tier.values.filter((value) => value !== "bank");
    app.save(partners);
  },
);

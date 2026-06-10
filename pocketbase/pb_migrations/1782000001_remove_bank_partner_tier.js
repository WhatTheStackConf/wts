/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const partners = app.findCollectionByNameOrId("partners");

    // If an already-applied local DB has legacy bank-tier rows, keep them visible
    // by moving them into the lowest current sponsor tier before removing the value.
    try {
      app.db().newQuery("UPDATE partners SET tier = 'bronze' WHERE tier = 'bank'").execute();
    } catch {
      // Some PocketBase JS runtimes expose collection helpers differently; the
      // select-value update below is the important schema change.
    }

    const tier = partners.fields.getByName("tier");
    tier.values = ["platinum", "gold", "silver", "bronze"];
    app.save(partners);
  },
  (app) => {
    const partners = app.findCollectionByNameOrId("partners");
    const tier = partners.fields.getByName("tier");
    tier.values = ["platinum", "gold", "silver", "bronze", "bank"];
    app.save(partners);
  },
);

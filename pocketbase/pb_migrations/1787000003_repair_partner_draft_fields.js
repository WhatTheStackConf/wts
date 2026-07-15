/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const partners = app.findCollectionByNameOrId("partners");
    const hasField = (name) => {
      try {
        return Boolean(partners.fields.getByName(name));
      } catch {
        return false;
      }
    };

    const needsMutationToken = !hasField("mutation_token");
    const needsLogoAttribution = !hasField("logo_uploaded_by_human");
    if (!needsMutationToken && !needsLogoAttribution) return;

    if (needsMutationToken) {
      partners.fields.add(new Field({ name: "mutation_token", type: "text", required: false }));
    }
    if (needsLogoAttribution) {
      partners.fields.add(new Field({ name: "logo_uploaded_by_human", type: "bool", required: false }));
    }
    app.save(partners);

    for (const partner of app.findAllRecords(partners)) {
      if (needsMutationToken) partner.set("mutation_token", partner.id);
      if (needsLogoAttribution) {
        partner.set("logo_uploaded_by_human", Boolean(partner.getString("logo")));
      }
      app.save(partner);
    }

    if (needsMutationToken) {
      partners.fields.getByName("mutation_token").required = true;
      app.save(partners);
    }
  },
  () => {
    // The lifecycle migration owns these fields; its rollback removes them.
  },
);

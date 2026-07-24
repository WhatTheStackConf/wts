/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const partners = app.findCollectionByNameOrId("partners");
    partners.fields.add(new Field({
      id: "select_partner_logo_surface",
      name: "logo_surface",
      type: "select",
      required: false,
      maxSelect: 1,
      values: ["dark", "light", "mixed"],
    }));
    app.save(partners);

    for (const partner of app.findAllRecords(partners)) {
      partner.set("logo_surface", "dark");
      app.save(partner);
    }

    partners.fields.getByName("logo_surface").required = true;
    return app.save(partners);
  },
  (app) => {
    const partners = app.findCollectionByNameOrId("partners");
    partners.fields.removeById("select_partner_logo_surface");
    return app.save(partners);
  },
);

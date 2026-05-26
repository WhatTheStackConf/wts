/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("cfp_submissions");

    try {
      if (collection.fields.getByName("status")) return;
    } catch {
      // field missing — add below
    }

    collection.fields.addAt(8, new Field({
      hidden: false,
      id: "select_cfp_sub_status",
      maxSelect: 1,
      name: "status",
      presentable: false,
      required: false,
      system: false,
      type: "select",
      values: ["pending", "accepted", "rejected"],
    }));

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("cfp_submissions");
    collection.fields.removeById("select_cfp_sub_status");
    return app.save(collection);
  },
);

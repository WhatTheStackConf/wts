/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.fields.add(
      new Field({
        name: "promo",
        type: "json",
        required: false,
      }),
    );
    app.save(speakers);
  },
  (app) => {
    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.fields.removeByName("promo");
    app.save(speakers);
  },
);

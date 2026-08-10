migrate(
  (app) => {
    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.fields.getByName("photo").thumbs = [
      "128x128",
      "256x256",
      "384x384",
    ];
    app.save(speakers);

    const partners = app.findCollectionByNameOrId("partners");
    partners.fields.getByName("logo").thumbs = ["320x0", "640x0", "1280x0"];
    app.save(partners);
  },
  (app) => {
    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.fields.getByName("photo").thumbs = [];
    app.save(speakers);

    const partners = app.findCollectionByNameOrId("partners");
    partners.fields.getByName("logo").thumbs = [];
    app.save(partners);
  },
);

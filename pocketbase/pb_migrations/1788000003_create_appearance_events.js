/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const appearanceEvents = new Collection({
      name: "appearance_events",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: "name",
          type: "text",
          required: true,
          presentable: true,
          max: 160,
        },
        {
          name: "compact_label",
          type: "text",
          required: false,
          max: 60,
        },
        {
          name: "published",
          type: "bool",
          required: false,
        },
        {
          name: "display_order",
          type: "number",
          required: false,
          min: 0,
          onlyInt: true,
        },
        {
          name: "destination_url",
          type: "text",
          required: false,
        },
      ],
    });
    app.save(appearanceEvents);

    const events = app.findCollectionByNameOrId("appearance_events");
    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.fields.add(
      new Field({
        name: "appearance_events",
        type: "relation",
        required: false,
        collectionId: events.id,
        maxSelect: 999,
        cascadeDelete: false,
      }),
    );
    app.save(speakers);

    const mainEvent = new Record(events, {
      id: "wts2026appevent",
      name: "WhatTheStack 2026",
      compact_label: "WTS 2026",
      published: true,
      display_order: 0,
      destination_url: "https://wts.sh",
    });
    app.save(mainEvent);

    for (const speaker of app.findRecordsByFilter("speakers", "published = true", "", 0, 0)) {
      speaker.set("appearance_events", [mainEvent.id]);
      app.saveNoValidate(speaker);
    }
  },
  (app) => {
    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.fields.removeByName("appearance_events");
    app.save(speakers);

    const appearanceEvents = app.findCollectionByNameOrId("appearance_events");
    app.delete(appearanceEvents);
  },
);

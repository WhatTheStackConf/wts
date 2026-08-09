/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const days = app.findCollectionByNameOrId("conference_days");
    const events = app.findCollectionByNameOrId("appearance_events");
    const eventProgrammes = new Collection({
      name: "event_programmes",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "day", type: "relation", required: true, collectionId: days.id, maxSelect: 1, cascadeDelete: false },
        { name: "appearance_event", type: "relation", required: true, collectionId: events.id, maxSelect: 1, cascadeDelete: false },
        { name: "display_order", type: "number", required: false },
      ],
    });
    eventProgrammes.addIndex("idx_event_programmes_day_event_unique", true, "day, appearance_event", "");
    eventProgrammes.addIndex("idx_event_programmes_day_order", false, "day, display_order, id", "");
    app.save(eventProgrammes);

    const programmes = app.findCollectionByNameOrId("event_programmes");
    const tracks = app.findCollectionByNameOrId("agenda_tracks");
    const slots = app.findCollectionByNameOrId("agenda_slots");
    tracks.fields.add(new Field({
      name: "programme",
      type: "relation",
      required: false,
      collectionId: programmes.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
    slots.fields.add(new Field({
      name: "programme",
      type: "relation",
      required: false,
      collectionId: programmes.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
    app.save(tracks);
    app.save(slots);

    const mainEvent = app.findRecordById("appearance_events", "wts2026appevent");
    const programmeByDay = {};
    const dayRows = app.findRecordsByFilter("conference_days", "", "display_order,local_date,id", 0, 0);
    for (const day of dayRows) {
      const programme = new Record(programmes, {
        day: day.id,
        appearance_event: mainEvent.id,
        display_order: 0,
      });
      app.save(programme);
      programmeByDay[day.id] = programme.id;
    }

    for (const track of app.findRecordsByFilter("agenda_tracks", "", "", 0, 0)) {
      track.set("programme", programmeByDay[track.getString("day")]);
      app.saveNoValidate(track);
    }
    for (const slot of app.findRecordsByFilter("agenda_slots", "", "", 0, 0)) {
      slot.set("programme", programmeByDay[slot.getString("day")]);
      app.saveNoValidate(slot);
      if (!slot.getBool("published") || slot.getString("kind") !== "session" || !slot.getString("session")) continue;
      const session = app.findRecordById("sessions", slot.getString("session"));
      for (const speakerId of session.getStringSlice("speakers")) {
        const speaker = app.findRecordById("speakers", speakerId);
        const appearances = speaker.getStringSlice("appearance_events");
        if (appearances.includes(mainEvent.id)) continue;
        speaker.set("appearance_events", [...appearances, mainEvent.id]);
        app.saveNoValidate(speaker);
      }
    }

    tracks.removeIndex("idx_agenda_tracks_day_key_unique");
    tracks.removeIndex("idx_agenda_tracks_day_order");
    tracks.fields.getByName("programme").required = true;
    tracks.fields.removeByName("day");
    tracks.addIndex("idx_agenda_tracks_programme_key_unique", true, "programme, key", "");
    tracks.addIndex("idx_agenda_tracks_programme_order", false, "programme, display_order, id", "");
    app.save(tracks);

    slots.removeIndex("idx_agenda_slots_day_start");
    slots.removeIndex("idx_agenda_slots_public_order");
    slots.fields.getByName("programme").required = true;
    slots.fields.removeByName("day");
    slots.addIndex("idx_agenda_slots_programme_start", false, "programme, start_at", "");
    slots.addIndex("idx_agenda_slots_public_order", false, "published, programme, start_at, track, display_order", "");
    app.save(slots);
  },
  (app) => {
    const days = app.findCollectionByNameOrId("conference_days");
    const programmes = app.findCollectionByNameOrId("event_programmes");
    const tracks = app.findCollectionByNameOrId("agenda_tracks");
    const slots = app.findCollectionByNameOrId("agenda_slots");

    tracks.fields.add(new Field({
      name: "day",
      type: "relation",
      required: false,
      collectionId: days.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
    slots.fields.add(new Field({
      name: "day",
      type: "relation",
      required: false,
      collectionId: days.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
    app.save(tracks);
    app.save(slots);

    for (const track of app.findRecordsByFilter("agenda_tracks", "", "", 0, 0)) {
      const programme = app.findRecordById("event_programmes", track.getString("programme"));
      track.set("day", programme.getString("day"));
      app.saveNoValidate(track);
    }
    for (const slot of app.findRecordsByFilter("agenda_slots", "", "", 0, 0)) {
      const programme = app.findRecordById("event_programmes", slot.getString("programme"));
      slot.set("day", programme.getString("day"));
      app.saveNoValidate(slot);
    }

    tracks.removeIndex("idx_agenda_tracks_programme_key_unique");
    tracks.removeIndex("idx_agenda_tracks_programme_order");
    tracks.fields.getByName("day").required = true;
    tracks.fields.removeByName("programme");
    tracks.addIndex("idx_agenda_tracks_day_key_unique", true, "day, key", "");
    tracks.addIndex("idx_agenda_tracks_day_order", false, "day, display_order, id", "");
    app.save(tracks);

    slots.removeIndex("idx_agenda_slots_programme_start");
    slots.removeIndex("idx_agenda_slots_public_order");
    slots.fields.getByName("day").required = true;
    slots.fields.removeByName("programme");
    slots.addIndex("idx_agenda_slots_day_start", false, "day, start_at", "");
    slots.addIndex("idx_agenda_slots_public_order", false, "published, day, start_at, track, display_order", "");
    app.save(slots);

    app.delete(programmes);
  },
);

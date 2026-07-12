/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const speakers = app.findCollectionByNameOrId("speakers");
    const sessions = app.findCollectionByNameOrId("sessions");

    // Public programme reads use allowlisted server DTOs. Raw records and relation
    // expansion would otherwise expose internal relation IDs and timestamps.
    speakers.listRule = null;
    speakers.viewRule = null;
    speakers.createRule = null;
    speakers.updateRule = null;
    speakers.deleteRule = null;
    app.save(speakers);
    sessions.listRule = null;
    sessions.viewRule = null;

    // Session creation and publication flow through server-authorized actions so
    // a published Session and its published Agenda Slot move together.
    sessions.createRule = null;
    sessions.updateRule = null;
    sessions.deleteRule = null;
    app.save(sessions);

    const conferenceDays = new Collection({
      name: "conference_days",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "key", type: "text", required: true, presentable: true, unique: true },
        { name: "local_date", type: "text", required: true },
        { name: "title", type: "text", required: true },
        { name: "display_order", type: "number", required: false },
        { name: "published", type: "bool", required: false },
      ],
    });
    app.save(conferenceDays);

    const days = app.findCollectionByNameOrId("conference_days");
    const tracks = new Collection({
      name: "agenda_tracks",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "day", type: "relation", required: true, collectionId: days.id, maxSelect: 1, cascadeDelete: false },
        { name: "key", type: "text", required: true },
        { name: "name", type: "text", required: true, presentable: true },
        { name: "location_label", type: "text", required: false },
        { name: "display_order", type: "number", required: false },
      ],
    });
    tracks.addIndex("idx_agenda_tracks_day_key_unique", true, "day, key", "");
    app.save(tracks);

    const agendaTracks = app.findCollectionByNameOrId("agenda_tracks");
    const slots = new Collection({
      name: "agenda_slots",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "day", type: "relation", required: true, collectionId: days.id, maxSelect: 1, cascadeDelete: false },
        { name: "track", type: "relation", required: false, collectionId: agendaTracks.id, maxSelect: 1, cascadeDelete: false },
        { name: "start_at", type: "date", required: true },
        { name: "end_at", type: "date", required: true },
        {
          name: "kind",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["session", "break", "meal", "networking", "opening", "closing", "other"],
        },
        { name: "published", type: "bool", required: false },
        { name: "display_order", type: "number", required: false },
        { name: "location_label", type: "text", required: false },
        { name: "session", type: "relation", required: false, collectionId: sessions.id, maxSelect: 1, cascadeDelete: false },
        { name: "title", type: "text", required: false },
        { name: "summary", type: "text", required: false },
      ],
    });
    slots.addIndex("idx_agenda_slots_session_unique", true, "session", "session != ''");
    slots.addIndex("idx_agenda_slots_day_start", false, "day, start_at", "");
    app.save(slots);
  },
  (app) => {
    const slots = app.findCollectionByNameOrId("agenda_slots");
    app.delete(slots);
    const tracks = app.findCollectionByNameOrId("agenda_tracks");
    app.delete(tracks);
    const days = app.findCollectionByNameOrId("conference_days");
    app.delete(days);

    const sessions = app.findCollectionByNameOrId("sessions");
    sessions.listRule = "published = true || @request.auth.role = 'admin'";
    sessions.viewRule = "published = true || @request.auth.role = 'admin'";
    sessions.createRule = "@request.auth.role = 'admin'";
    sessions.updateRule = "@request.auth.role = 'admin'";
    sessions.deleteRule = "@request.auth.role = 'admin'";
    app.save(sessions);

    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.listRule = "published = true || @request.auth.role = 'admin'";
    speakers.viewRule = "published = true || @request.auth.role = 'admin'";
    app.save(speakers);
  },
);

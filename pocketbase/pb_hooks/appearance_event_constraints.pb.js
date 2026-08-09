/// <reference path="../pb_data/types.d.ts" />

onRecordValidate((e) => {
  const original = e.record.original();
  if (!original.id || !original.getBool("published") || e.record.getBool("published")) {
    return e.next();
  }
  try {
    e.app.findCollectionByNameOrId("event_programmes");
  } catch {
    return e.next();
  }
  const programmes = e.app.findRecordsByFilter(
    "event_programmes",
    `appearance_event = "${e.record.id}"`,
    "",
    0,
    0,
  );
  for (const programme of programmes) {
    const publishedSlots = e.app.findRecordsByFilter(
      "agenda_slots",
      `programme = "${programme.id}" && published = true`,
      "",
      1,
      0,
    );
    if (publishedSlots.length) {
      throw new BadRequestError("Unpublish this Appearance Event's Slots before unpublishing the Event.");
    }
  }
  return e.next();
}, "appearance_events");

onRecordDelete((e) => {
  const assignedSpeakers = e.app.findRecordsByFilter(
    "speakers",
    `appearance_events.id ?= "${e.record.id}"`,
    "",
    1,
    0,
  );
  if (assignedSpeakers.length > 0) {
    throw new BadRequestError(
      "Remove this Appearance Event's Speaker assignments or unpublish it instead.",
    );
  }
  try {
    e.app.findCollectionByNameOrId("event_programmes");
  } catch {
    return e.next();
  }
  const programmes = e.app.findRecordsByFilter(
    "event_programmes",
    `appearance_event = "${e.record.id}"`,
    "",
    1,
    0,
  );
  if (programmes.length > 0) {
    throw new BadRequestError(
      "Remove this Appearance Event's Event Programmes or unpublish it instead.",
    );
  }
  return e.next();
}, "appearance_events");

onRecordValidate((e) => {
  const original = e.record.original();
  if (!original.id) return e.next();
  const assigned = e.record.getStringSlice("appearance_events");
  const removed = original.getStringSlice("appearance_events").filter((id) => !assigned.includes(id));
  if (!removed.length) return e.next();

  try {
    e.app.findCollectionByNameOrId("event_programmes");
    e.app.findCollectionByNameOrId("agenda_slots");
  } catch {
    return e.next();
  }
  const sessions = e.app.findRecordsByFilter("sessions", `speakers.id ?= "${e.record.id}"`, "", 0, 0);
  for (const session of sessions) {
    const slots = e.app.findRecordsByFilter(
      "agenda_slots",
      `session = "${session.id}" && published = true`,
      "",
      0,
      0,
    );
    for (const slot of slots) {
      const programme = e.app.findRecordById("event_programmes", slot.getString("programme"));
      if (removed.includes(programme.getString("appearance_event"))) {
        throw new BadRequestError(
          "Unpublish the Speaker's Session Slot before removing its required Event Appearance.",
        );
      }
    }
  }
  return e.next();
}, "speakers");

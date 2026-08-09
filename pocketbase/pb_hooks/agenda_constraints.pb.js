/// <reference path="../pb_data/types.d.ts" />

// PocketBase executes registered callbacks in isolated JS contexts, so callback helpers stay local.

onRecordValidate((e) => {
  const parseInstant = (value) => {
    if (!value) return null;
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const withZone = /(Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
    const instant = new Date(withZone);
    return Number.isNaN(instant.getTime()) ? null : instant;
  };
  const skopjeDate = (instant) => {
    const year = instant.getUTCFullYear();
    const lastSunday = (month) => {
      const date = new Date(Date.UTC(year, month + 1, 0));
      date.setUTCDate(date.getUTCDate() - date.getUTCDay());
      return date;
    };
    const dstStarts = lastSunday(2);
    dstStarts.setUTCHours(1, 0, 0, 0);
    const dstEnds = lastSunday(9);
    dstEnds.setUTCHours(1, 0, 0, 0);
    const offsetHours = instant >= dstStarts && instant < dstEnds ? 2 : 1;
    return new Date(instant.getTime() + offsetHours * 60 * 60 * 1000).toISOString().slice(0, 10);
  };
  const record = e.record;
  const original = record.original();
  if (original.id && original.getString("key") !== record.getString("key")) {
    throw new BadRequestError("Conference Day key is immutable.");
  }
  const date = record.getString("local_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestError("Conference Day date must use YYYY-MM-DD.");
  }
  const programmes = e.app.findRecordsByFilter("event_programmes", `day = "${record.id}"`, "", 0, 0);
  for (const programme of programmes) {
    const slots = e.app.findRecordsByFilter("agenda_slots", `programme = "${programme.id}"`, "", 0, 0);
    if (!record.getBool("published") && slots.some((slot) => slot.getBool("published"))) {
      throw new BadRequestError("Unpublish this Conference Day's Slots before unpublishing the Day.");
    }
    for (const slot of slots) {
      const start = parseInstant(slot.getString("start_at"));
      if (start && skopjeDate(start) !== date) {
        throw new BadRequestError("Move this Day's Slots before changing its local date.");
      }
    }
  }
  return e.next();
}, "conference_days");

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (
    original.id &&
    (original.getString("day") !== record.getString("day") ||
      original.getString("appearance_event") !== record.getString("appearance_event"))
  ) {
    throw new BadRequestError("Event Programme Conference Day and Appearance Event are immutable.");
  }
  try {
    e.app.findRecordById("conference_days", record.getString("day"));
    e.app.findRecordById("appearance_events", record.getString("appearance_event"));
  } catch {
    throw new BadRequestError("Event Programme must reference a valid Conference Day and Appearance Event.");
  }
  return e.next();
}, "event_programmes");

onRecordDelete((e) => {
  const tracks = e.app.findRecordsByFilter("agenda_tracks", `programme = "${e.record.id}"`, "", 1, 0);
  const slots = e.app.findRecordsByFilter("agenda_slots", `programme = "${e.record.id}"`, "", 1, 0);
  if (tracks.length || slots.length) {
    throw new BadRequestError("Remove this Event Programme's Tracks and Slots before deleting it.");
  }
  return e.next();
}, "event_programmes");

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (original.id && original.getString("key") !== record.getString("key")) {
    throw new BadRequestError("Track key is immutable.");
  }
  if (
    original.id &&
    original.getString("programme") &&
    original.getString("programme") !== record.getString("programme")
  ) {
    throw new BadRequestError("Track Event Programme is immutable once Slots may reference it.");
  }
  try {
    e.app.findRecordById("event_programmes", record.getString("programme"));
  } catch {
    throw new BadRequestError("Track must belong to a valid Event Programme.");
  }
  return e.next();
}, "agenda_tracks");

onRecordDelete((e) => {
  const slots = e.app.findRecordsByFilter("agenda_slots", `track = "${e.record.id}"`, "", 1, 0);
  if (slots.length) throw new BadRequestError("Move this Track's Slots before deleting it.");
  return e.next();
}, "agenda_tracks");

onRecordValidate((e) => {
  const parseInstant = (value) => {
    if (!value) return null;
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const withZone = /(Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
    const instant = new Date(withZone);
    return Number.isNaN(instant.getTime()) ? null : instant;
  };
  const skopjeDate = (instant) => {
    const year = instant.getUTCFullYear();
    const lastSunday = (month) => {
      const date = new Date(Date.UTC(year, month + 1, 0));
      date.setUTCDate(date.getUTCDate() - date.getUTCDay());
      return date;
    };
    const dstStarts = lastSunday(2);
    dstStarts.setUTCHours(1, 0, 0, 0);
    const dstEnds = lastSunday(9);
    dstEnds.setUTCHours(1, 0, 0, 0);
    const offsetHours = instant >= dstStarts && instant < dstEnds ? 2 : 1;
    return new Date(instant.getTime() + offsetHours * 60 * 60 * 1000).toISOString().slice(0, 10);
  };
  const findContext = (programmeId) => {
    try {
      const programme = e.app.findRecordById("event_programmes", programmeId);
      return {
        programme,
        day: e.app.findRecordById("conference_days", programme.getString("day")),
        appearanceEvent: e.app.findRecordById("appearance_events", programme.getString("appearance_event")),
      };
    } catch {
      throw new BadRequestError("Agenda Slot must belong to a valid Event Programme.");
    }
  };
  const requireAppearances = (session, appearanceEventId) => {
    for (const speakerId of session.getStringSlice("speakers")) {
      const speaker = e.app.findRecordById("speakers", speakerId);
      if (!speaker.getStringSlice("appearance_events").includes(appearanceEventId)) {
        throw new BadRequestError(
          "Every Session Speaker needs an Event Appearance for this Appearance Event before publishing the Slot.",
        );
      }
    }
  };
  const record = e.record;
  const programmeId = record.getString("programme");
  const trackId = record.getString("track");
  const sessionId = record.getString("session");
  const kind = record.getString("kind");
  const slotKinds = ["session", "break", "meal", "networking", "opening", "closing", "other"];
  const hasText = (value) => typeof value === "string" && value.trim().length > 0;
  const start = parseInstant(record.getString("start_at"));
  const end = parseInstant(record.getString("end_at"));
  const context = findContext(programmeId);

  if (!start || !end || end <= start) {
    throw new BadRequestError("Agenda Slot end time must be after its start time.");
  }
  if (skopjeDate(start) !== context.day.getString("local_date")) {
    throw new BadRequestError("Agenda Slot must start on its Conference Day in Europe/Skopje.");
  }
  if (record.getBool("published") && !context.day.getBool("published")) {
    throw new BadRequestError("Publish the Conference Day before publishing one of its Slots.");
  }
  if (record.getBool("published") && !context.appearanceEvent.getBool("published")) {
    throw new BadRequestError("Publish the Appearance Event before publishing one of its Slots.");
  }
  if (!slotKinds.includes(kind)) throw new BadRequestError("Agenda Slot kind is invalid.");

  if (trackId) {
    let track;
    try {
      track = e.app.findRecordById("agenda_tracks", trackId);
    } catch {
      throw new BadRequestError("Agenda Slot Track must exist.");
    }
    if (track.getString("programme") !== programmeId) {
      throw new BadRequestError("Agenda Slot Track must belong to the same Event Programme.");
    }
  }

  if (kind === "session") {
    if (!sessionId) throw new BadRequestError("Session Slots must select one Session.");
    let session;
    try {
      session = e.app.findRecordById("sessions", sessionId);
    } catch {
      throw new BadRequestError("Agenda Slot Session must exist.");
    }
    if (record.getBool("published")) {
      if (!session.getBool("published")) {
        throw new BadRequestError("Publish Session Slots through the coordinated programme operation.");
      }
      requireAppearances(session, context.appearanceEvent.id);
    }
    if (hasText(record.getString("title")) || hasText(record.getString("summary"))) {
      throw new BadRequestError("Session Slots use their linked Session title and abstract.");
    }
  } else {
    if (sessionId) throw new BadRequestError("Non-Session Slots cannot select a Session.");
    if (!hasText(record.getString("title")) || !hasText(record.getString("summary"))) {
      throw new BadRequestError("Non-Session Slots require both a title and summary.");
    }
  }

  const original = record.original();
  if (
    original.id &&
    (kind === "session" || original.getString("kind") === "session") &&
    original.getBool("published") !== record.getBool("published")
  ) {
    throw new BadRequestError("Change Session Slot publication through the coordinated programme operation.");
  }
  if (
    original.id &&
    original.getBool("published") &&
    ((original.getString("programme") && original.getString("programme") !== programmeId) ||
      original.getString("kind") !== kind ||
      original.getString("session") !== sessionId)
  ) {
    throw new BadRequestError("Unpublish this Slot before changing its Event Programme, kind, or linked Session.");
  }

  const programmeSlots = e.app.findRecordsByFilter("agenda_slots", `programme = "${programmeId}"`, "", 0, 0);
  for (const other of programmeSlots) {
    if (other.id === record.id) continue;
    const otherStart = parseInstant(other.getString("start_at"));
    const otherEnd = parseInstant(other.getString("end_at"));
    if (!otherStart || !otherEnd || !(start < otherEnd && end > otherStart)) continue;
    const otherTrackId = other.getString("track");
    if (!trackId || !otherTrackId || trackId === otherTrackId) {
      throw new BadRequestError("Agenda Slot overlaps a Programme-wide Slot or another Slot in the same Track.");
    }
  }
  return e.next();
}, "agenda_slots");

onRecordDelete((e) => {
  if (e.record.getBool("published")) {
    throw new BadRequestError("Unpublish this Agenda Slot before deleting it.");
  }
  return e.next();
}, "agenda_slots");

onRecordValidate((e) => {
  const findContext = (programmeId) => {
    try {
      const programme = e.app.findRecordById("event_programmes", programmeId);
      return {
        appearanceEvent: e.app.findRecordById("appearance_events", programme.getString("appearance_event")),
      };
    } catch {
      throw new BadRequestError("Agenda Slot must belong to a valid Event Programme.");
    }
  };
  const requireAppearances = (session, appearanceEventId) => {
    for (const speakerId of session.getStringSlice("speakers")) {
      const speaker = e.app.findRecordById("speakers", speakerId);
      if (!speaker.getStringSlice("appearance_events").includes(appearanceEventId)) {
        throw new BadRequestError(
          "Every Session Speaker needs an Event Appearance for this Appearance Event before publishing the Slot.",
        );
      }
    }
  };
  try {
    e.app.findCollectionByNameOrId("agenda_slots");
  } catch {
    return e.next();
  }
  const publishedSlots = e.app.findRecordsByFilter(
    "agenda_slots",
    `session = "${e.record.id}" && published = true`,
    "",
    2,
    0,
  );
  if (!e.record.getBool("published") && publishedSlots.length > 0) {
    throw new BadRequestError("Unpublish the Agenda Slot before unpublishing its Session.");
  }
  if (publishedSlots.length > 1) {
    throw new BadRequestError("A Session cannot have more than one published Agenda Slot.");
  }
  for (const slot of publishedSlots) {
    const context = findContext(slot.getString("programme"));
    requireAppearances(e.record, context.appearanceEvent.id);
  }
  return e.next();
}, "sessions");

routerAdd("POST", "/api/wts/programme/agenda-slots/{id}/publication", (e) => {
  const findContext = (app, programmeId) => {
    try {
      const programme = app.findRecordById("event_programmes", programmeId);
      return {
        day: app.findRecordById("conference_days", programme.getString("day")),
        appearanceEvent: app.findRecordById("appearance_events", programme.getString("appearance_event")),
      };
    } catch {
      throw new BadRequestError("Agenda Slot must belong to a valid Event Programme.");
    }
  };
  const requireAppearances = (app, session, appearanceEventId) => {
    for (const speakerId of session.getStringSlice("speakers")) {
      const speaker = app.findRecordById("speakers", speakerId);
      if (!speaker.getStringSlice("appearance_events").includes(appearanceEventId)) {
        throw new BadRequestError(
          "Every Session Speaker needs an Event Appearance for this Appearance Event before publishing the Slot.",
        );
      }
    }
  };
  const published = e.requestInfo().body.published;
  if (typeof published !== "boolean") {
    throw new BadRequestError("Agenda Slot publication requires a boolean state.");
  }
  const slotId = e.request.pathValue("id");
  $app.runInTransaction((txApp) => {
    const slot = txApp.findRecordById("agenda_slots", slotId);
    const context = findContext(txApp, slot.getString("programme"));
    if (published && !context.day.getBool("published")) {
      throw new BadRequestError("Publish the Conference Day before publishing one of its Slots.");
    }
    if (published && !context.appearanceEvent.getBool("published")) {
      throw new BadRequestError("Publish the Appearance Event before publishing one of its Slots.");
    }

    slot.set("published", published);
    if (slot.getString("kind") === "session") {
      const session = txApp.findRecordById("sessions", slot.getString("session"));
      if (published) requireAppearances(txApp, session, context.appearanceEvent.id);
      session.set("published", published);
      txApp.saveNoValidate(session);
      txApp.saveNoValidate(slot);
      return;
    }
    txApp.save(slot);
  });
  return e.json(200, { id: slotId, published });
}, $apis.requireSuperuserAuth());

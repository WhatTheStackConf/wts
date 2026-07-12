/// <reference path="../pb_data/types.d.ts" />

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (original.id && original.getString("key") !== record.getString("key")) {
    throw new BadRequestError("Conference Day key is immutable.");
  }

  const date = record.getString("local_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestError("Conference Day date must use YYYY-MM-DD.");
  }

  function parseInstant(value) {
    if (!value) return null;
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const withZone = /(Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
    const instant = new Date(withZone);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }

  function skopjeLocalDate(instant) {
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
    return new Date(instant.getTime() + offsetHours * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  const daySlots = e.app.findRecordsByFilter("agenda_slots", `day = "${record.id}"`, "", 0, 0);
  if (!record.getBool("published") && daySlots.some((slot) => slot.getBool("published"))) {
    throw new BadRequestError("Unpublish this Conference Day's Slots before unpublishing the Day.");
  }
  for (const slot of daySlots) {
    const start = parseInstant(slot.getString("start_at"));
    if (start && skopjeLocalDate(start) !== date) {
      throw new BadRequestError("Move this Day's Slots before changing its local date.");
    }
  }
  return e.next();
}, "conference_days");

onRecordValidate((e) => {
  const record = e.record;
  const original = record.original();
  if (original.id && original.getString("key") !== record.getString("key")) {
    throw new BadRequestError("Track key is immutable.");
  }
  if (original.id && original.getString("day") !== record.getString("day")) {
    throw new BadRequestError("Track Conference Day is immutable once Slots may reference it.");
  }
  const dayId = record.getString("day");
  if (!dayId) throw new BadRequestError("Track must belong to a Conference Day.");
  try {
    e.app.findRecordById("conference_days", dayId);
  } catch {
    throw new BadRequestError("Track must belong to a valid Conference Day.");
  }
  return e.next();
}, "agenda_tracks");

onRecordValidate((e) => {
  const record = e.record;
  const dayId = record.getString("day");
  const trackId = record.getString("track");
  const sessionId = record.getString("session");
  const kind = record.getString("kind");
  const slotKinds = ["session", "break", "meal", "networking", "opening", "closing", "other"];

  function hasText(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function parseInstant(value) {
    if (!hasText(value)) return null;
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const withZone = /(Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
    const instant = new Date(withZone);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }

  function skopjeLocalDate(instant) {
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
    return new Date(instant.getTime() + offsetHours * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  const start = parseInstant(record.getString("start_at"));
  const end = parseInstant(record.getString("end_at"));
  let day;
  try {
    day = e.app.findRecordById("conference_days", dayId);
  } catch {
    throw new BadRequestError("Agenda Slot must belong to a valid Conference Day.");
  }
  if (!start || !end || end <= start) {
    throw new BadRequestError("Agenda Slot end time must be after its start time.");
  }
  if (skopjeLocalDate(start) !== day.getString("local_date")) {
    throw new BadRequestError("Agenda Slot must start on its Conference Day in Europe/Skopje.");
  }
  if (record.getBool("published") && !day.getBool("published")) {
    throw new BadRequestError("Publish the Conference Day before publishing one of its Slots.");
  }
  if (!slotKinds.includes(kind)) throw new BadRequestError("Agenda Slot kind is invalid.");

  if (trackId) {
    let track;
    try {
      track = e.app.findRecordById("agenda_tracks", trackId);
    } catch {
      throw new BadRequestError("Agenda Slot Track must exist.");
    }
    if (track.getString("day") !== dayId) {
      throw new BadRequestError("Agenda Slot Track must belong to the same Conference Day.");
    }
  }

  if (kind === "session") {
    if (!sessionId) throw new BadRequestError("Session Slots must select one Session.");
    try {
      const session = e.app.findRecordById("sessions", sessionId);
      if (record.getBool("published") && !session.getBool("published")) {
        throw new BadRequestError("Publish Session Slots through the coordinated programme operation.");
      }
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new BadRequestError("Agenda Slot Session must exist.");
    }
    if (hasText(record.getString("title")) || hasText(record.getString("summary"))) {
      throw new BadRequestError("Session Slots use their linked Session title and abstract.");
    }
  } else {
    if (sessionId) throw new BadRequestError("Non-Session Slots cannot select a Session.");
    if (!hasText(record.getString("title")) || !hasText(record.getString("summary"))) {
      throw new BadRequestError("Non-Session Slots require a title and summary.");
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
    original.getString("kind") === "session" &&
    (kind !== "session" || original.getString("session") !== sessionId)
  ) {
    throw new BadRequestError("Unpublish this Session Slot before changing its kind or linked Session.");
  }

  const allSlots = e.app.findRecordsByFilter("agenda_slots", "", "", 0, 0);
  for (const other of allSlots) {
    if (other.id === record.id) continue;
    const otherStart = parseInstant(other.getString("start_at"));
    const otherEnd = parseInstant(other.getString("end_at"));
    if (!otherStart || !otherEnd || !(start < otherEnd && end > otherStart)) continue;
    const otherTrackId = other.getString("track");
    if (!trackId || !otherTrackId || trackId === otherTrackId) {
      throw new BadRequestError("Agenda Slot overlaps an all-attendee Slot or another Slot in the same Track.");
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
  const record = e.record;
  try {
    e.app.findCollectionByNameOrId("agenda_slots");
  } catch {
    // The Session collection predates Agenda Slots, so migration rollback restores standalone Sessions.
    return e.next();
  }
  const publishedSlots = e.app.findRecordsByFilter(
    "agenda_slots",
    `session = "${record.id}" && published = true`,
    "",
    2,
    0,
  );
  if (!record.getBool("published") && publishedSlots.length > 0) {
    throw new BadRequestError("Unpublish the Agenda Slot before unpublishing its Session.");
  }
  if (record.getBool("published")) {
    if (publishedSlots.length !== 1) {
      throw new BadRequestError("A published Session requires exactly one published Agenda Slot.");
    }
  }
  return e.next();
}, "sessions");

routerAdd("POST", "/api/wts/programme/agenda-slots/{id}/publication", (e) => {
  const published = e.requestInfo().body.published;
  if (typeof published !== "boolean") {
    throw new BadRequestError("Agenda Slot publication requires a boolean state.");
  }
  const slotId = e.request.pathValue("id");
  $app.runInTransaction((txApp) => {
    const slot = txApp.findRecordById("agenda_slots", slotId);
    const day = txApp.findRecordById("conference_days", slot.getString("day"));
    if (published && !day.getBool("published")) {
      throw new BadRequestError("Publish the Conference Day before publishing one of its Slots.");
    }

    slot.set("published", published);
    if (slot.getString("kind") === "session") {
      const session = txApp.findRecordById("sessions", slot.getString("session"));
      session.set("published", published);
      txApp.saveNoValidate(session);
      txApp.saveNoValidate(slot);
      return;
    }
    txApp.save(slot);
  });
  return e.json(200, { id: slotId, published });
}, $apis.requireSuperuserAuth());

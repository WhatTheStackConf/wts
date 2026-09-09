/// <reference path="../pb_data/types.d.ts" />
// Organizer-confirmed September 2026 times, Europe/Skopje (UTC+02:00).
// Content-only update: preserve publication flags and unrelated timeline fields.
migrate((app) => {
  const updates = [
    {
      id: "wk2600000000001",
      event_date: "2026-09-14 12:00:00.000Z",
      description: "Requests, Lies, and Stack Traces: a four-hour cybersecurity and application-security workshop, 14:00–18:00 (Skopje time). Included with your WhatTheStack ticket. Limited availability, registration opens closer to the date.",
    },
    {
      id: "wk2600000000002",
      event_date: "2026-09-16 15:00:00.000Z",
      description: "Starts at 17:00 (Skopje time) at FINKI. GDG Skopje brings practical AI, accessibility, and agentic systems, including Akshata Mohanty's Building a distributed multi-agent system with Google Cloud. Requires a separate GDG ticket.",
    },
    {
      id: "wk2600000000003",
      event_date: "2026-09-17 08:00:00.000Z",
      description: "Starts at 10:00 (Skopje time). A full day on .NET MAUI and cross-platform development at FINKI. Requires separate registration.",
    },
  ];
  const collection = app.findCollectionByNameOrId("timeline_events");
  const records = app.findAllRecords(collection);
  for (const update of updates) {
    const record = records.find((item) => item.id === update.id);
    if (!record) continue;
    record.set("event_date", update.event_date);
    record.set("description", update.description);
    app.save(record);
  }
  const thursday = records.find((record) => record.id === "wk2600000000004");
  if (thursday) {
    thursday.set("description", "Hands-on pre-conference workshops on software architecture, payments, and frontend engineering. Faris Aziz's Payments and Monetization at Scale for Frontend Engineers workshop runs 16:30–20:00 (3.5 hours, Skopje time). Available as a checkout add-on.");
    app.save(thursday);
  }
  // Tuesday was absent from the original conference-week timeline seed.
  if (!records.some((record) => record.id === "wk2600000000006" || record.getString("title") === "Workshop Tuesday: iOS + AI")) {
    app.save(new Record(collection, {
      id: "wk2600000000006",
      title: "Workshop Tuesday: iOS + AI",
      event_date: "2026-09-15 14:00:00.000Z",
      icon: "🛠️",
      description: "AI talk at 16:00, followed by the iOS workshop at 18:00 (Skopje time), both at Base42 Hackerspace, Rimska 25. Free entry. No ticket required. End times to be announced.",
      link_text: "View the agenda",
      link_url: "/agenda?day=2026-09-15",
      is_published: true,
    }));
  }
}, () => {
  // Forward-only content correction; rolling back code must not restore wrong times.
});

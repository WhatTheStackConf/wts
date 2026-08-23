/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // The conference week as it appears on /timeline. Dates and entry rules match
    // src/lib/conference-week.ts.
    const weekEvents = [
      {
        id: "wk2600000000001",
        title: "InfoSec Monday",
        event_date: "2026-09-14 09:00:00.000Z",
        icon: "🔐",
        description:
          "A dedicated cybersecurity and application-security workshop for WhatTheStack ticket holders. Limited availability, registration opens closer to the date.",
        link_text: "Grab a ticket",
        link_url: "/tickets",
      },
      {
        id: "wk2600000000002",
        title: "DevFest: Day Zero x WhatThe(Google)Stack",
        event_date: "2026-09-16 09:00:00.000Z",
        icon: "🤖",
        description:
          "A Google-focused day with GDG Skopje on practical AI, accessibility, and agentic systems. Requires a separate GDG ticket.",
        link_text: "Get a GDG ticket",
        link_url:
          "https://gdg.community.dev/events/details/google-gdg-skopje-presents-pre-devfest-days-day-zero-x-whatthegooglestack-2/",
      },
      {
        id: "wk2600000000003",
        title: "MAUI Day Skopje",
        event_date: "2026-09-17 09:00:00.000Z",
        icon: "📱",
        description:
          "A full day on .NET MAUI and cross-platform development at FINKI. Requires separate registration.",
        link_text: "Register for MAUI Day",
        link_url:
          "https://www.eventbrite.nl/e/net-maui-day-skopje-2026-tickets-1992309951697",
      },
      {
        id: "wk2600000000005",
        title: "Angular Day",
        event_date: "2026-09-18 09:00:00.000Z",
        icon: "🅰️",
        description:
          "A full day for Angular and frontend engineering with the international and local Angular community. Included with your WhatTheStack ticket.",
        link_text: "Grab a ticket",
        link_url: "/tickets",
      },
      {
        id: "wk2600000000004",
        title: "Workshop Thursday",
        event_date: "2026-09-17 10:00:00.000Z",
        icon: "🛠️",
        description:
          "Hands-on pre-conference workshops on software architecture, payments, and frontend engineering. Available as a checkout add-on.",
        link_text: "Add a workshop",
        link_url: "/tickets",
      },
    ];

    const timeline = app.findCollectionByNameOrId("timeline_events");
    const existingIds = new Set(
      Array.from(app.findAllRecords(timeline), (record) => record.getString("id")),
    );

    for (const event of weekEvents) {
      if (existingIds.has(event.id)) continue;

      const record = new Record(timeline, {
        id: event.id,
        title: event.title,
        description: event.description,
        icon: event.icon,
        event_date: event.event_date,
        link_text: event.link_text,
        link_url: event.link_url,
        is_published: true,
      });
      app.save(record);
    }
  },
  (app) => {
    const seededIds = [
      "wk2600000000001",
      "wk2600000000002",
      "wk2600000000003",
      "wk2600000000004",
      "wk2600000000005",
    ];

    for (const id of seededIds) {
      try {
        app.delete(app.findRecordById("timeline_events", id));
      } catch {
        // Already gone; nothing to roll back for this row.
      }
    }
  },
);

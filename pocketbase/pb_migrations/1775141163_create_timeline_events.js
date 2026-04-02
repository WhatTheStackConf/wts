/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = new Collection({
      name: "timeline_events",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "@request.auth.role = 'admin'",
      updateRule: "@request.auth.role = 'admin'",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: "title",
          type: "text",
          required: true,
        },
        {
          name: "description",
          type: "text",
          required: false,
        },
        {
          name: "icon",
          type: "text",
          required: false,
        },
        {
          name: "event_date",
          type: "date",
          required: true,
        },
        {
          name: "link_url",
          type: "text",
          required: false,
        },
        {
          name: "link_text",
          type: "text",
          required: false,
        },
        {
          name: "is_published",
          type: "bool",
          required: false,
        },
      ],
    });

    app.save(collection);

    // Seed initial timeline data
    const events = [
      {
        title: "WhatTheStack 2026 Announced",
        description: "We're back! September 19th, 2026 in Skopje. Bigger venue, more tracks, same vibes.",
        icon: "🚀",
        event_date: "2025-11-15T00:00:00Z",
        link_url: null,
        link_text: null,
        is_published: true,
      },
      {
        title: "Ticket Sales Open",
        description: "Early access tickets are live. €50, no early bird pricing games — same price from start to finish.",
        icon: "🎟️",
        event_date: "2026-01-15T00:00:00Z",
        link_url: "/tickets",
        link_text: "Grab a ticket",
        is_published: true,
      },
      {
        title: "Call for Proposals Opens",
        description: "Got a talk in you? Submit your proposal. Every submission is anonymized and reviewed by our committee. Travel and accommodation covered for selected speakers.",
        icon: "📢",
        event_date: "2026-02-01T00:00:00Z",
        link_url: "/cfp",
        link_text: "Apply to speak",
        is_published: true,
      },
      {
        title: "First Speaker Announcements",
        description: "The first batch of confirmed speakers drops. Names, topics, the works.",
        icon: "🎤",
        event_date: "2026-04-15T00:00:00Z",
        link_url: "/speakers",
        link_text: "View speakers",
        is_published: true,
      },
      {
        title: "CfP Deadline",
        description: "Last chance to submit your talk proposal. Don't sleep on it.",
        icon: "⏰",
        event_date: "2026-06-01T00:00:00Z",
        link_url: "/cfp",
        link_text: "Submit before it's too late",
        is_published: true,
      },
      {
        title: "Full Agenda Published",
        description: "All tracks, all talks, all times. Plan your day.",
        icon: "📋",
        event_date: "2026-07-15T00:00:00Z",
        link_url: "/agenda",
        link_text: "View the agenda",
        is_published: true,
      },
      {
        title: "WhatTheStack 2026",
        description: "The main event. One day. Multiple tracks. All things software, all things code. See you in Skopje.",
        icon: "🔥",
        event_date: "2026-09-19T00:00:00Z",
        link_url: "/tickets",
        link_text: "Get your ticket",
        is_published: true,
      },
    ];

    const col = app.findCollectionByNameOrId("timeline_events");
    for (const evt of events) {
      const record = new Record(col);
      record.set("title", evt.title);
      record.set("description", evt.description);
      record.set("icon", evt.icon);
      record.set("event_date", evt.event_date);
      record.set("link_url", evt.link_url);
      record.set("link_text", evt.link_text);
      record.set("is_published", evt.is_published);
      app.save(record);
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("timeline_events");
    app.delete(collection);
  }
);

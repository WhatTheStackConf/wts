# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Past attendees who check what comes next after the 2026 edition.
- New visitors who hear about WhatTheStack for the first time, usually from a shared link.
- Possible speakers who want to know when the call for papers opens.
- Possible partners and sponsors who judge whether the event is worth their support.

All four groups arrive before the 2027 facts exist. They must understand what WTS is and sign up for updates.

## Product Purpose

`@wts/site` is the public website for WhatTheStack 2027. It gives an evergreen introduction to the conference and community. It publishes confirmed announcements as they become available. It hosts the legal pages and the newsletter signup. It also serves account pages, a public JSON API, and a public MCP endpoint for programme data.

Success means three things. Visitors understand WTS. They believe that 2027 is a bigger step for a real community. They subscribe to updates.

## Positioning

- Local developer communities run WhatTheStack. A company does not own it.
- It is the main cross-stack developer conference in Macedonia and the region.
- Web, AI, infrastructure, DevOps, and product decisions share one room.
- The hallway matters: the conversations between talks are part of the event.

## Operating Context

- Visitors arrive from shared links, social posts, and the past edition sites.
- The newsletter uses the existing Listmonk integration with Turnstile.
- Accounts use central OIDC at auth.wts.sh. The site keeps no passwords.
- The call for papers is a separate app at cfp.wts.sh. The blog is at blog.wts.sh.
- Private operational screens (admin, check-in, reviewer) live in the root application, not in this site.

## Capabilities and Constraints

- Stack: SolidStart, Node 24.15, `node:sqlite`, Tailwind CSS v4, DaisyUI.
- Public routes: the landing, legal pages, not-found, login, registration, and the user profile.
- Programme data comes only through reviewed `PublicContentBatchV1` imports.
- WTS 2027 is a bigger step than earlier editions. The specific facts are not announced yet.
- Not announced: the 2027 date, location, time zone, venue, programme, speakers, partners, and ticket prices. Do not reuse 2026 facts as 2027 announcements.

## Brand Commitments

- Name: WhatTheStack. Short form: WTS.
- Organizers: DeveD, Base42, and Angular Macedonia.
- Keep the original WTS logo artwork until a 2027 logo exists.
- Tagline in use: "All things software. All things code."
- WTS is a Skopje conference. The site can show Skopje.

## Evidence on Hand

- Three past editions with live sites: https://2024.wts.sh, https://2025.wts.sh, and https://2026.wts.sh.
- The 2026 edition took place in Skopje on 2026-09-19.
- The community copy on the current landing page, in `src/components/landing/Landing2027.tsx`.
- Contact: what@wts.sh.
- Not on hand: attendance numbers, testimonials, partner logos for 2027, and speaker names for 2027. Do not invent them.

## Product Principles

- Truth before excitement. Show only confirmed facts. Let the experience carry the energy.
- The community leads. WTS is people who build software, not a brand selling tickets.
- Content never waits. Motion and effects must not delay reading, navigation, or signup.
- One action matters most before announcements: get updates.

## Accessibility & Inclusion

- Target WCAG 2.2 AA.
- Obey reduced-motion and data-saving preferences. Decorative motion stops when they are set.
- Keep visible keyboard focus, 44 px touch targets, and semantic landmarks.
- Support widths from 320 px to 1920 px.

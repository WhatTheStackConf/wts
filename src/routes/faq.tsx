import { Layout } from "../layouts/Layout";
import { For } from "solid-js";
import { HologramButton } from "../components/HologramButton";
import {
  conferenceGuideContent,
  conferenceLocation,
  conferenceLongDate,
  conferenceTicketPrice,
} from "~/lib/conference-guide-content";
import { sanitizeHtml } from "~/lib/sanitize-html";

type FAQItem = {
  question: string;
  answer: string;
};

type FAQSection = {
  title: string;
  items: FAQItem[];
};

const faqSections: FAQSection[] = [
  {
    title: "General",
    items: [
      {
        question: "When and where is the conference taking place?",
        answer: `WhatTheStack 2026 will be held on <strong>${conferenceLongDate}</strong> at the <strong>${conferenceGuideContent.mainVenue.name}</strong> in ${conferenceLocation}. The conference will span the FINKI, FEIT, and Mechanical Engineering campuses, with ${conferenceGuideContent.mainVenue.spaces.outdoorStages} outdoor stages and ${conferenceGuideContent.mainVenue.spaces.indoorStages} indoor stages. Workshops and pre-conference events will also be held at <strong>${conferenceGuideContent.preConferenceVenue.name}</strong> (${conferenceGuideContent.preConferenceVenue.address}).`,
      },
      {
        question: "What can I expect at WhatTheStack?",
        answer:
          "A full day of talks, workshops, and community activities focused on the future of software development. Expect deep technical content, great networking opportunities, and the occasional surprise. We also plan pre-conference events and a community gathering the evening before.",
      },
      {
        question: "Who should attend?",
        answer:
          "Developers, platform engineers, AI researchers, startup founders, designers, and anyone curious about the modern tech stack. We cover the full spectrum &mdash; web, AI/ML, infrastructure, DevOps, soft skills, and everything in between. Whether you're a seasoned architect or just getting started, there's something here for you. No dress code required.",
      },
      {
        question: "Do you have a Code of Conduct?",
        answer: `Yes. Read our <a href="${conferenceGuideContent.codeOfConduct.canonicalPath}" class="text-primary-400 hover:text-primary-300 underline">Code of Conduct</a>. We're committed to providing a safe and inclusive environment for everyone. Any breach will be taken seriously and may result in being asked to leave the event.`,
      },
      {
        question: "Can I apply to speak?",
        answer: `Our Call for Papers is currently open! Head over to the <a href="/cfp" class="text-primary-400 hover:text-primary-300 underline">CFP page</a> to submit your talk. Main conference sessions are 25+10 minutes &mdash; the extra 10 can be used for Q&amp;A or as additional time for your talk (speaker's choice).`,
      },
      {
        question: "When is the full agenda going to be published?",
        answer:
          "We aim to publish the full agenda by mid-July. In the meantime, keep an eye on our <a href='/timeline' class='text-primary-400 hover:text-primary-300 underline'>timeline</a> for a general overview of what's planned.",
      },
    ],
  },
  {
    title: "Tickets & Registration",
    items: [
      {
        question: "How do I get a ticket?",
        answer: `Head over to our <a href="/tickets" class="text-primary-400 hover:text-primary-300 underline">tickets page</a> and pick the option that works best for you. We offer regular conference entry, workshop add-ons, and student tickets.`,
      },
      {
        question: "Do you offer any discounts?",
        answer: `We keep our pricing flat and affordable from start to finish &mdash; no early bird games. That said, we do offer a few options:<br/><br/>
          <ul class="list-disc list-inside space-y-1">
            <li><strong>Student Ticket</strong> &mdash; ${conferenceTicketPrice("student")} with valid student ID</li>
            <li><strong>Group Discount</strong> &mdash; 5-20% off for groups of 5+ attendees</li>
            <li><strong>Community Partner Discount</strong> &mdash; available through our partner communities</li>
          </ul>
          <br/>
          <span class="text-secondary-300 font-mono text-sm">P.S. &mdash; since you actually read the FAQ: use code <strong class="text-primary-400">RTFAQ-2026</strong> for 5% off.</span>`,
      },
      {
        question: "Can I transfer, refund, or cancel my ticket?",
        answer: `You can transfer your ticket to another person at any time. Refunds are possible in exceptional cases. Contact us at <a href="mailto:${conferenceGuideContent.contact.generalEmail}" class="text-primary-400 hover:text-primary-300 underline">${conferenceGuideContent.contact.generalEmail}</a> and we'll work it out.`,
      },
      {
        question: "Are team discounts or payment via invoice available?",
        answer: `Yes! We offer volume discounts and can issue invoices for company purchases. Send us an email at <a href="mailto:${conferenceGuideContent.contact.generalEmail}" class="text-primary-400 hover:text-primary-300 underline">${conferenceGuideContent.contact.generalEmail}</a> for details.`,
      },
    ],
  },
  {
    title: "Venue & Travel",
    items: [
      {
        question: "How do I get to Skopje?",
        answer: `Skopje International Airport (SKP) has direct connections to many European cities. From the airport, the city center is about a 30-minute drive. Budget airlines like Wizz Air and others operate regular flights. Skopje is also reachable by bus from neighboring countries.`,
      },
      {
        question: "Are there recommended hotels near the venue?",
        answer:
          "Recommended hotels and partner rates have not been announced. Skopje is very affordable compared to most European cities &mdash; expect great value for accommodation.",
      },
      {
        question: "Is the venue accessible?",
        answer:
          `Accessibility details have not been announced. If you have specific accessibility needs, please reach out to us at <a href="mailto:${conferenceGuideContent.accessibility.contactEmail}" class="text-primary-400 hover:text-primary-300 underline">${conferenceGuideContent.accessibility.contactEmail}</a> and we'll do our best to accommodate you.`,
      },
      {
        question: "Do I need a visa?",
        answer:
          "Macedonia has a fairly open visa policy &mdash; citizens of most European, North American, and many other countries can enter visa-free. Check your country's requirements. If you need an invitation letter, we can provide one after you purchase your ticket.",
      },
    ],
  },
  {
    title: "Supporting the Conference",
    items: [
      {
        question: "How can I support the conference?",
        answer: `There are many ways to help!<br/><br/>
          <ul class="list-disc list-inside space-y-1">
            <li><strong>Attend</strong> &mdash; the most important one</li>
            <li><strong>Spread the word</strong> &mdash; tell your friends and colleagues</li>
            <li><strong>Become a sponsor</strong> &mdash; check our <a href="/partnerships" class="text-primary-400 hover:text-primary-300 underline">partnerships page</a></li>
            <li><strong>Volunteer</strong> &mdash; we always need help on the day</li>
            <li><strong>Submit a talk</strong> &mdash; share your knowledge</li>
          </ul>`,
      },
      {
        question: "Can I become a sponsor or exhibitor?",
        answer: `Absolutely! We have several sponsorship tiers available. Check out our <a href="/partnerships" class="text-primary-400 hover:text-primary-300 underline">partnerships page</a> or contact us at <a href="mailto:${conferenceGuideContent.contact.generalEmail}" class="text-primary-400 hover:text-primary-300 underline">${conferenceGuideContent.contact.generalEmail}</a> for the sponsorship prospectus.`,
      },
      {
        question: "Who can I contact if I have additional questions?",
        answer: `Drop us an email at <a href="mailto:${conferenceGuideContent.contact.generalEmail}" class="text-primary-400 hover:text-primary-300 underline">${conferenceGuideContent.contact.generalEmail}</a> &mdash; we usually reply within a day or two.`,
      },
    ],
  },
];

export default function FAQ() {
  return (
    <Layout
      title="FAQ - WhatTheStack 2026"
      description="Frequently asked questions about WhatTheStack 2026 conference in Skopje"
      ogSubtitle="Frequently Asked Questions"
    >
      <div class="w-full h-full px-4 relative">
        <div class="absolute inset-0 scanline z-10"></div>
        <div class="max-w-4xl mx-auto relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-4 text-center neon-glow fade-in">
            FAQ
          </h1>
          <p class="text-center text-secondary-300 mb-12 text-lg fade-in-delay-1">
            Answers to the questions you haven't asked yet.
          </p>

          <For each={faqSections}>
            {(section, sectionIndex) => (
              <div
                class="mb-10 fade-in"
                style={{ "animation-delay": `${(sectionIndex() + 1) * 150}ms` }}
              >
                <h2 class="text-2xl font-star font-bold text-secondary-300 mb-4 uppercase tracking-wider border-b border-primary-500/30 pb-2">
                  {section.title}
                </h2>
                <div class="space-y-2">
                  <For each={section.items}>
                    {(item) => (
                      <div class="collapse collapse-arrow bg-base-200/60 backdrop-blur-sm border border-primary-500/20 hover:border-primary-500/40 transition-colors">
                        <input type="radio" name={`faq-${section.title}`} />
                        <div class="collapse-title font-semibold text-lg text-primary-100">
                          {item.question}
                        </div>
                        <div
                          class="collapse-content text-secondary-100/90 leading-relaxed"
                          innerHTML={sanitizeHtml(item.answer)}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>

          <div class="text-center mt-16 mb-8 fade-in-delay-4 flex flex-col items-center gap-6">
            <p class="text-secondary-400">
              Still have questions? Reach out at{" "}
              <a
                href={`mailto:${conferenceGuideContent.contact.generalEmail}`}
                class="text-primary-400 hover:text-primary-300 underline"
              >
                {conferenceGuideContent.contact.generalEmail}
              </a>
            </p>
            <HologramButton
              href="/tickets"
              text="Get your tickets"
              class="px-8 py-3 text-xl h-auto"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}

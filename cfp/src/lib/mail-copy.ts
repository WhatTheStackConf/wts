// Speaker-facing CFP email copy. The wording is approved in
// ~/Downloads/UI_Moodboard/source/cfp-decision-email.md. Keep the WTS voice: plain, honest, "we".

export interface MailCopy { subject: string; text: string }
interface CopyInput { editionId: string; title: string; link: string }

const SUBJECT_LIMIT = 200;

// Subjects allow no control characters and at most 200 characters, so the title shrinks to fit.
function subject(template: (title: string) => string, title: string): string {
  const clean = title.replace(/\p{Cc}+/gu, " ").trim();
  const room = SUBJECT_LIMIT - template("").length;
  return template(clean.length > room ? `${clean.slice(0, room - 1)}…` : clean);
}

export function submissionMail(input: CopyInput & { operation: "created" | "updated" }): MailCopy {
  return {
    subject: subject((title) => input.operation === "created" ? `Got it: "${title}"` : `Got your changes: "${title}"`, input.title),
    text: `Hi,

Your proposal for WhatTheStack ${input.editionId} is in. Thanks for sending it!

What happens next: the review committee scores it on six criteria, without seeing your name. Then we, the organizers, make the call. Until then, your proposal shows "Pending".

You can still edit it while it's pending. Edits stay in a private draft until you submit them again.

Your proposal: ${input.link}

The WTS team
`,
  };
}

export function decisionMail(input: CopyInput & { status: "accepted" | "rejected" }): MailCopy {
  if (input.status === "accepted") {
    return {
      subject: subject((title) => `You're in: "${title}" is on the WTS ${input.editionId} lineup`, input.title),
      text: `Hi,

Good news: we picked "${input.title}" for WhatTheStack ${input.editionId}. Congrats, and thanks for putting real work into it.

We'll send dates, the schedule and travel details as soon as we have them. Until then, there's nothing you need to do. (Well, maybe start on the slides ;))

Your proposal: ${input.link}

See you on stage,
The WTS team
`,
    };
  }
  return {
    subject: subject((title) => `About "${title}" for WTS ${input.editionId}`, input.title),
    text: `Hi,

Thanks for sending "${input.title}" to WhatTheStack ${input.editionId}. We didn't pick it for the lineup this time.

The honest version: we got a lot more good proposals than we have slots, and some calls came down to small margins. This isn't a verdict on you as a speaker.

Want to know how it scored? Reply to this email and we'll share the committee's notes.

We'd love to see you in the audience, and to read your next proposal.

Your proposal: ${input.link}

The WTS team
`,
  };
}

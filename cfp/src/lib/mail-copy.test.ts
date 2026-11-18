import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decisionMail, submissionMail } from "./mail-copy.ts";

const link = "https://cfp.wts.sh/applications/7d3b0f61-2b0a-4a6e-9a1c-0c8f6c1e5d42";

describe("submission confirmation copy", () => {
  it("names the talk and links the proposal without internal numbers", () => {
    const mail = submissionMail({ editionId: "2027", title: "Caching at scale", link, operation: "created" });
    assert.equal(mail.subject, 'Got it: "Caching at scale"');
    assert.match(mail.text, /Your proposal for WhatTheStack 2027 is in\./);
    assert.match(mail.text, /without seeing your name/);
    assert.ok(mail.text.includes(`Your proposal: ${link}`));
    assert.doesNotMatch(mail.text, /Committed|revision|Application:/i);
    assert.equal(mail.text.split("7d3b0f61").length, 2, "The proposal ID shows only inside the link.");
  });

  it("uses a different subject for an edit", () => {
    assert.equal(submissionMail({ editionId: "2027", title: "Caching at scale", link, operation: "updated" }).subject, 'Got your changes: "Caching at scale"');
  });
});

describe("decision copy", () => {
  it("tells an accepted speaker they are on the lineup", () => {
    const mail = decisionMail({ editionId: "2027", title: "Caching at scale", link, status: "accepted" });
    assert.equal(mail.subject, `You're in: "Caching at scale" is on the WTS 2027 lineup`);
    assert.match(mail.text, /we picked "Caching at scale" for WhatTheStack 2027/);
    assert.ok(mail.text.includes(`Your proposal: ${link}`));
    assert.match(mail.text, /See you on stage,\nThe WTS team\n$/);
  });

  it("tells a rejected speaker and offers the committee notes", () => {
    const mail = decisionMail({ editionId: "2027", title: "Caching at scale", link, status: "rejected" });
    assert.equal(mail.subject, 'About "Caching at scale" for WTS 2027');
    assert.match(mail.text, /We didn't pick it for the lineup this time\./);
    assert.match(mail.text, /Reply to this email and we'll share the committee's notes\./);
    assert.ok(mail.text.includes(`Your proposal: ${link}`));
  });

  it("keeps a long title inside the subject limit", () => {
    const mail = decisionMail({ editionId: "2027", title: "x".repeat(400), link, status: "accepted" });
    assert.ok(mail.subject.length <= 200);
    assert.ok(mail.text.includes("x".repeat(400)));
  });

  it("strips line breaks from the subject", () => {
    const mail = submissionMail({ editionId: "2027", title: "Two\nlines", link, operation: "created" });
    assert.doesNotMatch(mail.subject, /[\r\n]/);
  });
});

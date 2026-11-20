// Specimen markup for the flight kit, one entry per control family.
// Moved from the build_specimen.py page on 2026-11-20. Edit here from now on.

export interface Specimen { n: number; title: string; note: string; html: string }

export const SPECIMENS: Specimen[] = [
  {
    "n": 1,
    "title": "Plate · primary action",
    "note": "Fill on ::before, dot scan on ::after. Dots move away from the text colour.",
    "html": "<div class=\"sp-row\" data-states><button class=\"fk-plate\">Get updates <svg viewBox=\"0 0 256 256\" width=\"16\" height=\"16\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"m221.7 133.7-72 72a8 8 0 0 1-11.4-11.4L196.7 136H40a8 8 0 0 1 0-16h156.7l-58.4-58.3a8 8 0 0 1 11.4-11.4l72 72a8 8 0 0 1 0 11.4Z\"/></svg></button><button class=\"fk-plate is-danger\">Revoke decision</button><button class=\"fk-plate\" disabled>Submitting…</button></div>\n<div class=\"sp-row sp-night\" data-states><button class=\"fk-plate is-night\">Get updates <svg viewBox=\"0 0 256 256\" width=\"16\" height=\"16\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"m221.7 133.7-72 72a8 8 0 0 1-11.4-11.4L196.7 136H40a8 8 0 0 1 0-16h156.7l-58.4-58.3a8 8 0 0 1 11.4-11.4l72 72a8 8 0 0 1 0 11.4Z\"/></svg></button></div>"
  },
  {
    "n": 2,
    "title": "Frame · secondary action",
    "note": "",
    "html": "<div class=\"sp-row\" data-states><a class=\"fk-frame\" href=\"#\">Past editions</a><button class=\"fk-frame is-accent\">Sign out of this site</button></div>"
  },
  {
    "n": 3,
    "title": "Icon button",
    "note": "",
    "html": "<div class=\"sp-row\" data-states><button class=\"fk-icon is-close\" aria-label=\"Close\"><svg viewBox=\"0 0 256 256\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M208.5 191.5a12 12 0 0 1-17 17L128 145l-63.5 63.5a12 12 0 0 1-17-17L111 128 47.5 64.5a12 12 0 0 1 17-17L128 111l63.5-63.5a12 12 0 0 1 17 17L145 128Z\"/></svg></button><button class=\"fk-icon\" aria-label=\"Show password\"><svg viewBox=\"0 0 256 256\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M128 56C48 56 16 128 16 128s32 72 112 72 112-72 112-72-32-72-112-72Zm0 112a40 40 0 1 1 40-40 40 40 0 0 1-40 40Z\"/></svg></button><button class=\"fk-icon\" aria-pressed=\"false\" aria-label=\"Bold\"><svg viewBox=\"0 0 256 256\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M170 122a44 44 0 0 0-30-78H72v168h80a46 46 0 0 0 18-90ZM96 68h44a20 20 0 0 1 0 40H96Zm56 120H96v-56h56a28 28 0 0 1 0 56Z\"/></svg></button><button class=\"fk-icon\" aria-pressed=\"true\" aria-label=\"Bold\"><svg viewBox=\"0 0 256 256\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M170 122a44 44 0 0 0-30-78H72v168h80a46 46 0 0 0 18-90ZM96 68h44a20 20 0 0 1 0 40H96Zm56 120H96v-56h56a28 28 0 0 1 0 56Z\"/></svg></button></div>"
  },
  {
    "n": 4,
    "title": "Links",
    "note": "",
    "html": "<div class=\"sp-row\" data-states><a class=\"fk-nav-link\" href=\"#\">The conference</a><a class=\"fk-nav-link\" href=\"#\">Past editions</a></div>\n<p class=\"sp-copy\" data-states>Read the <a class=\"fk-link\" href=\"#\">code of conduct</a> before you apply. Copy links keep a dotted rule at rest and wrap like text.</p>"
  },
  {
    "n": 5,
    "title": "Fields",
    "note": "Frame drawn with background layers: no wrapper. Focus scans a dot line along the foot.",
    "html": "<div class=\"sp-grid\" data-states>\n<label><span class=\"fk-label\">Email address (required)</span><input class=\"fk-field\" type=\"email\" placeholder=\"you@example.com\"></label>\n<label><span class=\"fk-label\">Search posts</span><input class=\"fk-field\" type=\"search\" value=\"solid\"></label>\n<label><span class=\"fk-label\">Email address (required)</span><input class=\"fk-field\" type=\"email\" value=\"not-an-email\" aria-invalid=\"true\"><span class=\"fk-help is-error\">Enter a full email address.</span></label>\n<label><span class=\"fk-label\">Disabled</span><input class=\"fk-field\" disabled value=\"Locked after submit\"></label>\n<label class=\"sp-wide\"><span class=\"fk-label is-question\">Can your company cover travel or accommodation?</span><select class=\"fk-field\"><option>Yes</option><option>No</option><option>Other</option></select></label>\n<label><span class=\"fk-label\">Track</span><select class=\"fk-field\"><option>Frontend</option><option>Backend</option></select></label>\n<label class=\"sp-wide\"><span class=\"fk-label\">Abstract</span><textarea class=\"fk-field\">Tell reviewers what your talk covers.</textarea><span class=\"fk-help\">Markdown is not supported.</span></label>\n</div>"
  },
  {
    "n": 6,
    "title": "Checkbox, radio, switch",
    "note": "",
    "html": "<div class=\"sp-grid\" data-states>\n<label class=\"fk-choice\"><input class=\"fk-check\" type=\"checkbox\"> I agree to the code of conduct</label>\n<label class=\"fk-choice\"><input class=\"fk-check\" type=\"checkbox\" checked> Send me updates</label>\n<label class=\"fk-choice\"><input class=\"fk-check sp-indeterminate\" type=\"checkbox\"> Select all rows</label>\n<label class=\"fk-choice\"><input class=\"fk-radio\" type=\"radio\" name=\"r\"> Talk</label>\n<label class=\"fk-choice\"><input class=\"fk-radio\" type=\"radio\" name=\"r\" checked> Workshop</label>\n<label class=\"fk-choice\"><input class=\"fk-switch\" type=\"checkbox\" role=\"switch\" checked> Open</label>\n<label class=\"fk-choice\"><input class=\"fk-switch\" type=\"checkbox\" role=\"switch\"> Reviewing closed</label>\n<label class=\"fk-choice\"><input class=\"fk-check\" type=\"checkbox\" disabled> Disabled</label>\n</div>"
  },
  {
    "n": 7,
    "title": "Fieldset",
    "note": "",
    "html": "<fieldset class=\"fk-fieldset\"><legend>Speaking experience</legend>\n<label class=\"fk-choice\"><input class=\"fk-radio\" type=\"radio\" name=\"x\" checked> First talk</label>\n<label class=\"fk-choice\"><input class=\"fk-radio\" type=\"radio\" name=\"x\"> I have spoken before</label></fieldset>"
  },
  {
    "n": 8,
    "title": "Tabs",
    "note": "",
    "html": "<nav class=\"fk-tabs\" data-states aria-label=\"Admin\"><a href=\"#\" aria-current=\"page\">Applications</a><a href=\"#\">Staff</a><a href=\"#\">Settings</a></nav>"
  },
  {
    "n": 9,
    "title": "Stepper",
    "note": "",
    "html": "<ol class=\"fk-stepper\"><li class=\"is-complete\"><span class=\"fk-step\">1</span>Speaker</li><li class=\"is-complete\"><span class=\"fk-step\">2</span>Experience</li><li aria-current=\"step\"><span class=\"fk-step\">3</span>Proposal</li><li><span class=\"fk-step\">4</span>Confirm</li></ol>"
  },
  {
    "n": 10,
    "title": "Status chip and tag",
    "note": "The square marks the state. The text names it, so colour is never the only signal.",
    "html": "<div class=\"sp-row\"><span class=\"fk-chip is-ok\">Accepted</span><span class=\"fk-chip is-warn\">Pending review</span><span class=\"fk-chip is-bad\">Rejected</span><span class=\"fk-chip\">Submitted</span><span class=\"fk-chip is-idle\">Draft</span></div>\n<div class=\"sp-row\" data-states><a class=\"fk-tag\" href=\"#\">Frontend</a><a class=\"fk-tag\" href=\"#\">DevOps</a><span class=\"fk-tag\">Read only</span></div>"
  },
  {
    "n": 11,
    "title": "Notice",
    "note": "",
    "html": "<div class=\"sp-stack\"><p class=\"fk-notice\">The call for papers opens soon. Dates and details to follow.</p>\n<p class=\"fk-notice is-ok\">Your proposal is saved.</p>\n<p class=\"fk-notice is-warn\">Your session expires in 5 minutes.</p>\n<p class=\"fk-notice is-bad\">Newsletter sign-up is currently unavailable. Please check back later.</p></div>"
  },
  {
    "n": 12,
    "title": "Table",
    "note": "",
    "html": "<div class=\"fk-table-wrap\" role=\"region\" aria-label=\"Applications\" tabindex=\"0\"><table class=\"fk-table\"><thead><tr><th>Talk</th><th>Speaker</th><th>Status</th><th>Score</th></tr></thead><tbody>\n<tr><td><a class=\"fk-link\" href=\"#\">Signals all the way down</a></td><td>Ana P.</td><td><span class=\"fk-chip is-ok\">Accepted</span></td><td>4.6</td></tr>\n<tr class=\"is-selected\"><td><a class=\"fk-link\" href=\"#\">Shipping a monorepo</a></td><td>Marko T.</td><td><span class=\"fk-chip is-warn\">Pending</span></td><td>3.9</td></tr>\n<tr data-hover-row><td><a class=\"fk-link\" href=\"#\">The hallway track</a></td><td>Elena K.</td><td><span class=\"fk-chip\">Submitted</span></td><td>—</td></tr>\n</tbody></table></div>"
  },
  {
    "n": 13,
    "title": "Pagination",
    "note": "",
    "html": "<nav class=\"fk-pagination\" aria-label=\"Pages\" data-states><a href=\"#\" aria-label=\"Previous page\">←</a><a href=\"#\">1</a><span aria-current=\"page\">2</span><a href=\"#\">3</a><a href=\"#\" aria-label=\"Next page\">→</a></nav>"
  },
  {
    "n": 14,
    "title": "Disclosure",
    "note": "",
    "html": "<details class=\"fk-details\" open><summary>What happens after I apply?</summary><p>Reviewers score each proposal. You get an email when the programme is set.</p></details>\n<details class=\"fk-details\"><summary>Can I submit more than one talk?</summary><p>Yes.</p></details>"
  },
  {
    "n": 15,
    "title": "Menu",
    "note": "",
    "html": "<div class=\"fk-menu\" role=\"menu\" data-states><a href=\"#\" role=\"menuitem\" aria-current=\"page\">Your profile</a><a href=\"#\" role=\"menuitem\">Applications</a><button role=\"menuitem\">Sign out</button></div>"
  },
  {
    "n": 16,
    "title": "Tooltip and kbd",
    "note": "",
    "html": "<div class=\"sp-row\"><span class=\"fk-tooltip\">Copied to clipboard</span><span>Search <kbd class=\"fk-kbd\">Ctrl</kbd> <kbd class=\"fk-kbd\">K</kbd></span></div>"
  },
  {
    "n": 17,
    "title": "Progress",
    "note": "",
    "html": "<div class=\"sp-stack\"><div class=\"fk-progress\" style=\"--fk-value: 60%\" role=\"progressbar\" aria-valuenow=\"60\" aria-valuemin=\"0\" aria-valuemax=\"100\" aria-label=\"Upload\"></div>\n<div class=\"fk-progress is-busy\" role=\"status\" aria-label=\"Loading\"></div></div>"
  },
  {
    "n": 18,
    "title": "Skip link",
    "note": "Hidden above the page until it gets keyboard focus. The specimen shows it in place.",
    "html": "<div class=\"sp-row\" data-states><a class=\"fk-plate fk-skip\" style=\"position:static;translate:0\" href=\"#c1\">Skip to main content</a></div>"
  },
  {
    "n": 19,
    "title": "Dialog",
    "note": "",
    "html": "<div class=\"fk-dialog\" style=\"max-width:30rem\"><button class=\"fk-icon is-close\" aria-label=\"Close\" style=\"position:absolute;top:.75rem;right:.75rem\"><svg viewBox=\"0 0 256 256\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M208.5 191.5a12 12 0 0 1-17 17L128 145l-63.5 63.5a12 12 0 0 1-17-17L111 128 47.5 64.5a12 12 0 0 1 17-17L128 111l63.5-63.5a12 12 0 0 1 17 17L145 128Z\"/></svg></button>\n<h3 class=\"sp-dialog-title\">Conference updates</h3><p>Get occasional news about WTS and the software community.</p>\n<label><span class=\"fk-label\">Email address (required)</span><input class=\"fk-field\" type=\"email\"></label>\n<p><button class=\"fk-plate\" style=\"width:100%\">Subscribe</button></p></div>"
  }
];

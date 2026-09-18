# QR Missions: organizer guide and release checks

## Two supported paths

- **Direct reward:** scan an official QR → sign in if needed → the configured Activity award is recorded.
- **Questions:** scan → sign in → complete the question workflow → the configured Activity award is recorded only when the answers qualify.

The same shared code can be used by different Users. Each User can earn the Activity only once, including through replacement or separately registered codes. Existing total-XP and Leaderboard-XP policies, caps, Badges and Meta evaluation still apply. A scan is bearer evidence, not proof of physical location or time spent attending.

## Configure a direct QR reward

In `/admin/gamification`:

1. In **Score schedules**, create a draft schedule with an explicit effective time.
2. In **Catalog**, optionally create an Achievement for the Badge, then create the Mission and its public or hidden visibility and operating window.
3. Create an Activity of kind **qr**, category appropriate to the Mission (default **social**), outcome **completion**, evidence **single_code**. Link its Mission and optional Achievement. Set its operating window and participant limit.
4. Save the Activity, then **Edit draft** to attach the draft score schedule and desired **Total XP** and **Leaderboard XP**. QR policy membership includes its Activity, category and conference; an optional score day also adds the day cap.
5. Leave questions unattached for immediate points.
6. Activate the Achievement (if used), Mission and Activity. Activate the reviewed scoring schedule.
7. Generate new codes in **Mission codes**, or register existing printed identifiers in **Printed codes**.

Do not infer a complete launch catalogue from the presence of an active empty bootstrap schedule. The first positive score schedule determines the initial level ladder; review the full intended inventory and ceilings rather than activating a one-activity test schedule in production.

## Add a question workflow

Before activating a **qr** Activity, open **QR questions**:

1. Select the draft QR Activity.
2. Choose the award rule:
   - **All answers must be correct:** every question must match an accepted answer.
   - **Answer every question (participation):** every required answer must be present and any selected choice must be one of the offered options.
   - **All correct: full XP; any wrong: half XP** (`correct_or_half`): every valid, fully answered submission completes the Mission and qualifies for its Badge. All answers correct earns the full configured total and leaderboard XP; any wrong answer earns exactly half of each configured amount, before existing caps. Odd configured values can award `.5` XP. Missing, blank, unknown-choice or malformed answers earn nothing. Accepted answers are required for every question.
3. Add 1–10 questions. Each can be a text answer or single-choice question with 2–8 options.
4. For text questions requiring correctness, enter one accepted answer per line. Matching ignores outer whitespace and letter case, with Unicode normalization; there is no AI or fuzzy judging.
5. For single-choice questions, enter one option label per line and the accepted option numbers, starting at 1.
6. Supply a code-free configuration reason and **Save questions**.
7. Complete the activation/scoring/code steps above.

Question rules are private and editable only while the Activity remains a draft without codes or claims. They are locked after activation. Create a successor Activity for a changed live workflow; never silently change a code from direct rewards to questions or reprice completed work.

Question prompts are bounded to 500 characters and submitted text to 1000 characters. Correct-answer keys are never returned to attendees. Raw free-text responses are not retained for survey exports: the system retains qualification and idempotency evidence, not survey content.

## Attendee behavior

- Open the QR with the phone's normal camera, or use `/missions/redeem` for manual entry.
- The official link uses `/missions/redeem#code=…`, keeping the bearer value out of normal HTTP request URLs. Pending codes remain only in that tab's short-lived session storage.
- Question scans create a private challenge, not an accepted redemption or XP event. Challenges last at most 15 minutes and remain constrained by code and Activity windows.
- Under **All answers must be correct**, wrong answers award no points. Incomplete or malformed answers award nothing under every policy. **Try questions again** starts a fresh attempt using the still-pending code. After the pending code expires, scan again.
- Under **correct_or_half**, a valid wrong answer completes the Mission at half credit, not as a retryable failure. The award is final: a repeat scan or correct-after-wrong submission cannot upgrade it. Both full- and half-credit completion retain one immutable server-evaluated outcome, with no browser-supplied score or multiplier. The accepted redemption binds the exact private attempt; the claim freezes the scaled, capped amounts. Interrupted accounting repairs retain that outcome and those amounts, including after restart or challenge expiry.
- A lost answer response holds the exact command and answers for retry; do not edit it into a different command. A repeat can repair interrupted accounting but cannot award twice.
- A different QR scanned while a request or question workflow is pending is explicitly rejected, without replacing the current code. Finish the current Mission, then scan the other QR again.
- Code invalidation, Activity/Mission retirement, expiry and participant limits are rechecked on completion. Another User cannot submit a challenge or earn its points under a stale tab's identity.
- Throttling is per authenticated User rather than a shared low venue-IP/browser quota. Invalid-prefix protection remains. A cooldown countdown re-enables controls without a reload; it does not auto-submit retries.

`/missions` lists public, code-backed Missions and distinguishes open and upcoming windows. Hidden discoveries stay hidden. The profile shows earned progress; suggestions filter completed and unavailable Activities. Public leaderboard privacy remains opt-out, not opt-in.

## New QR images

The one-time code response now includes a **Mission QR code** preview and **Download QR** PNG for each generated code, in addition to the existing CSV.

- The PNG encodes the full current site's redemption-fragment URL.
- It uses black modules, opaque white background, a four-module quiet zone and Q error correction.
- Download and securely retain the original CSV/images before clearing the panel. Leaving the Mission codes tab clears the one-time secret response.
- Print without cropping the white margin or blurring modules. A digital decode test does not replace scanning the physical print on actual phones under venue lighting.
- Do not place bearer-code exports in public Git/assets or ordinary support messages. Physical deployment at the approved Mission is intentional; publishing all codes on socials would permit remote redemption.

## Register already-printed codes

Use **Printed codes** rather than generating replacements:

1. Select the exact active Activity the printed codes should represent. For questions, attach and lock the question workflow before this step.
2. Set a safe batch label, evidence role, code window (explicit Skopje time) and maximum participants per code.
3. Paste one full existing code per line, at most 100. Preserve the original manifest; do not paste URLs or substitute new random identifiers.
4. Select **Register printed codes**. Every supplied identifier is validated independently on the server and hashed with the target environment's pepper.
5. Check the committed receipt and quantity. Raw values clear after acknowledgement; the receipt contains only safe record IDs/prefixes.

Registration is atomic: malformed input, duplicate supplied identities or an existing prefix/hash reject the batch without partially registering codes. An unchanged operation retry returns the same receipt, including after a lost response. Changed payloads cannot reuse the old operation ID. Existing invalidated codes cannot be resurrected by registering them again.

## Schema and deployment requirements

Apply the additive migrations only through an authorized release:

- `1786000012_create_gamification_questions.js`: private questionnaire/attempt collections and generic QR Activity kind.
- `1786000013_harden_gamification_unique_keys.js`: actual unique indexes for distributed locks, catalogue keys and accounting idempotency identities. Legacy TextField `unique: true` declarations did not create these database constraints.
- `1786000014_question_half_credit.js`: additive `passed_half` terminal attempt status. No historical awards or private definitions are rewritten. Deploy with the matching application and question hook; rollback must retain existing half-credit evidence.

Both the application and `gamification_questions.pb.js` hook are required. The hook prevents live question changes, enforces challenge binding and retained evidence, and refuses an accepted question redemption without approved evidence.

Before migration, inspect duplicate values for every new unique index and expired/duplicate operation locks. **Do not delete or merge accounting history automatically** to make a migration pass. Conflicts deliberately block migration and require reviewed reconciliation. Back up the live database and uploads consistently before deployment. Keep the code pepper unchanged for existing code registrations.

The audit found the production catalogue empty on 2026-09-16; this implementation does not seed real questions, rewards, codes or prizes. Production activation and social announcements still require organizer-approved content and an explicit release/rehearsal.

## Verification commands

- `pnpm test:gamification` — accounting/import/question contracts, real disposable PocketBase integration, catalogue and transport tests, plus a bundled Chromium RPC test.
- `pnpm test:gamification-browser` — isolated production build with a disposable database; organizer setup, independent QR decoding/download, login/questions, wrong answers, exact lost-response retry, direct/shared rewards, printed-code registration, identity fencing and cooldown controls.
- `pnpm test` — complete configured application suite, including the new backend tests.
- `pnpm typecheck`
- `pnpm test:workspace-browser` — adjacent signed-in workspace/mobile regression suite.

The fixture defaults to the repository's test PocketBase binary. To rehearse the deployed PocketBase version without replacing that binary, set `WTS_TEST_POCKETBASE_BINARY=/absolute/path/to/pocketbase-0.34.0` for the gamification commands. Fixtures use loopback-only databases and exclude real credentials, mail and outbound hooks.

Required final live check after authorized deployment: approved physical QR → login → direct reward or questions → qualifying answer → one award → repeat scan → unchanged total → profile and leaderboard/privacy checks. Keep actual venue-network capacity and physical scanning separate from automated fixture proof.

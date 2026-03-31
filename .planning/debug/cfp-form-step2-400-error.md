---
status: awaiting_human_verify
trigger: "CFP form submission fails at step 2 with HTTP 400 error when calling PocketBase API endpoint /api/collections/cfp_applicants/records"
created: 2026-03-31T00:00:00Z
updated: 2026-03-31T00:01:00Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: CONFIRMED - `affiliation` field is marked required in PocketBase schema but has no frontend validation, so empty submissions fail. Additionally the form's UX intent treats affiliation as optional (no asterisk, no validation message).
test: Verified live schema via sqlite query - affiliation is required:true in _collections.fields JSON
expecting: Fix by making affiliation optional in the PocketBase schema (migration) to match UX intent
next_action: Create migration to make affiliation optional + add frontend validation for affiliation as a belt-and-suspenders fix

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: User fills out CFP form step 2 and can continue to the next step
actual: Server returns HTTP 400 with empty data object when trying to create a cfp_applicants record
errors: HTTP 400 {"data":{},"message":"Failed to create record.","status":400}
reproduction: Go to CFP form, fill in step 2 fields, submit/continue
started: Bug report received, unclear when it started

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: PocketBase hook on cfp_applicants causes the error
  evidence: cfp.pb.js hook only targets cfp_submissions collection, not cfp_applicants
  timestamp: 2026-03-31T00:01:00Z

- hypothesis: Unique constraint violation on user field
  evidence: SQLite PRAGMA index_list shows only sqlite_autoindex_cfp_applicants_1 on id column, no unique index on user
  timestamp: 2026-03-31T00:01:00Z

- hypothesis: SQLite trigger interfering with record creation
  evidence: PRAGMA shows no triggers on cfp_applicants table
  timestamp: 2026-03-31T00:01:00Z

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-03-31T00:01:00Z
  checked: cfp-store.ts updateApplicant function
  found: On create (no applicant_id), sends user, affiliation, bio, social_handles, preferred_contact_method, previous_talks
  implication: All required fields are sent, but affiliation may be empty string

- timestamp: 2026-03-31T00:01:00Z
  checked: 02-personal.tsx handleNext validation
  found: Validates full_name and short_bio (bio) but NOT affiliation before calling updateApplicant
  implication: Users can submit with empty affiliation, which fails PB required check

- timestamp: 2026-03-31T00:01:00Z
  checked: Live PocketBase schema via sqlite3 query on data.db
  found: affiliation field has required:true, bio (editor type) has required:true, user has required:true
  implication: Confirmed - affiliation is required in schema but not validated on frontend

- timestamp: 2026-03-31T00:01:00Z
  checked: Form UX design in 02-personal.tsx
  found: Affiliation field has no asterisk (*), no required indicator, no client-side validation, placeholder says "Senior Engineer @ Tech Corp"
  implication: The UX intent is that affiliation is optional; the required:true in schema is an oversight/mismatch

- timestamp: 2026-03-31T00:01:00Z
  checked: Empty data:{} in error response
  found: When affiliation is empty, PocketBase returns {"data":{},"message":"Failed to create record.","status":400}
  implication: Empty data object (vs field-level errors) may be PocketBase v0.30.4 behavior when required text field is empty, or may indicate schema/DB level rejection before field validation

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: The `affiliation` field in the cfp_applicants PocketBase collection is marked required:true but the frontend form (step 2) has no validation for this field and does not mark it as required to users. When a user submits without filling in affiliation (empty string), PocketBase rejects the record creation with HTTP 400 {"data":{},...}. The empty data:{} (rather than field-specific errors) is PocketBase v0.30.4 behavior for this case.
fix: Created migration 1774942493_updated_cfp_applicants.js to set affiliation field (id: text3933345072) required:false. This matches the UX intent (field has no asterisk, no client-side validation, placeholder only). Migration includes both up (make optional) and down (revert to required) functions.
verification:
files_changed:
  - pocketbase/pb_migrations/1774942493_updated_cfp_applicants.js

# Fireside host persona correction — 2026-09-17

Darko Bozhinovski and Miodrag Cekikj are speakers/fireside hosts, not stage MCs. The organizer explicitly requested clearing their public `speakers.is_mc` flags. No account authorization roles, session relations, appearance-event memberships, opening/closing portraits, photos, biographies or timetable records change.

**Current full-programme verifier:** `python3 -B scripts/fireside-host-roles.py --verify`. It accepts only both flags corrected, restores the two historical flags in memory, then validates the transfer-gap/host/Stage 5 baseline. Older standalone verifiers retain historical expectations and must not be used to restore the obsolete MC designation.

The executor applies exactly two PATCHes in one existing-enabled PocketBase batch. It requires a verified private backup, exclusive-writer acknowledgement, exact preflight, readback and unrelated-record comparison. Three real PocketBase 0.34 integration tests cover exact changes, rollback, lost committed response/no-op, partial-role refusal and unrelated-data preservation.

## Operational verification

The initial API acknowledgement/readback occurred during a subsequently detected PocketBase SQLite `disk I/O error (522)` incident. Public speaker queries failed with 400, image source lookups with misleading 404, and the public programme endpoint with 503; health checks remained green. A separate read-only SQLite connection returned integrity `ok`, but showed that the role flags were still true on disk.

A private stopped full-volume archive was checksum-verified before restarting the same PocketBase container. All canonical programme table hashes/counts matched across restart. No restore/schema change was performed. The web process was restarted to refresh its backend authentication. The exact two-flag correction was then reapplied and verified through both API readback and an independent SQLite connection: both flags false, integrity `ok`. Public reads and real photo decoding recovered, and subsequent verifier execution was a zero-write no-op. The precise engine-level trigger remains unproven; do not describe the restart as a permanent code fix.

Backup recovery material and before-state audits are private, outside the repository. The source original profile import remains historical, including its former MC flag; it must not override this later organizer correction.

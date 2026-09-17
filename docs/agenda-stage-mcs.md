# Stage MCs and fireside hosts

Organizer-confirmed on `2026-09-17` for the main-day Appearance Event `wts2026appevent`:

| Displayed stage | Immutable Track key | MC |
| --- | --- | --- |
| Stage 1 | `stage-2` | Tony Edwards |
| Stage 2 | `stage-3` | Stojan Ezhov |
| Stage 3 | `stage-1` | Dimitar Grozdanov |
| Stage 4 | `stage-4` | Nikola Dinevski |
| Stage 5 | `stage-5` | Marijana Ilovska Zlatanovska |

`src/lib/programme-stage-mcs.ts` is the explicit edition assignment source. Do not infer the displayed number from the stable key. The public projection includes only published profiles with `is_mc=true` and explicit membership in the main-day event. It returns only public slug, name and photo URL; a missing profile/MC flag/appearance omits the row rather than inventing a replacement.

The agenda shows a portrait/link row below each desktop stage heading, and below the mobile stage picker for the selected stage. `PublicAgendaTrack.mcs` is optional and documented in the public OpenAPI contract. Empty/unassigned stages do not get empty MC labels.

Darko Bozhinovski and Miodrag Cekikj are **speakers and fireside hosts, not stage MCs**. Their public `speakers.is_mc` flags are false. This is unrelated to account authorization: no user roles or moderation permissions are changed. Their existing Session relations, per-session Host sections, Darko's opening/closing portraits and all timings stay intact. Historical import manifests may describe the original MC flag before this organizer correction; they are not authority to restore the old designation.

## Verification

- `pnpm exec vp test run src/lib/programme-stage-mcs.test.ts src/lib/programme-hosts.test.ts src/components/AgendaProgramme.test.tsx src/lib/conference-public.test.ts src/lib/public-api.test.ts`
- `node scripts/verify-hosts-ui.mjs PUBLIC_FIELD_SNAPSHOT_JSON EVIDENCE_DIRECTORY` after a production CSS build. This mounted-component check uses a read-only public-data snapshot, verifies all five assignments and switching back, image decoding, host separation and overflow at 390px/1440px. It is not full-route deployment proof.
- After rollout, check the public JSON tracks, actual stage picker/header rows, both host profiles without an MC badge, and retained Host sections. Confirm the shifted schedule remains unchanged.

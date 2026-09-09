# Name Label renderer and station profiles

Issue: [#47](https://github.com/WhatTheStackConf/wts/issues/47). Scope: WTS 2026 administrative profile configuration and preview, **not** admission, print dispatch, operator replacement or hardware calibration.

## Admin surface

Use **Name Label profiles and preview** at `/admin/checkin` with an existing admin User session. Operators and anonymous callers cannot read profiles, preview labels, configure profiles or record approvals. Every API operation validates the session and the PocketBase command seam rereads the current verified admin role. There is no new agent credential, station-binding authority or MCP endpoint here.

1. Preview with the explicitly synthetic profile, or choose a saved exact profile version. Enter only name and affiliation; absent affiliation remains blank. The browser displays the server's actual PNG, not a separately fitted approximation. Editing text clears the old image. **Clear preview text and raster** removes the transient inputs/output from the surface.
2. Set the station's printer asset reference using existing station configuration. Choose that station in the Name Label section. The profile binds to its exact printer reference and station configuration version.
3. Configure explicit printer/stock measurements. Synthetic mode is visibly identified and never approvable. Switching to measured mode clears synthetic dot values; enter the actual measurements. Saving always creates a **new unapproved version**, never overwrites earlier geometry.
4. Preview the saved version. Screen rendering, font loading, hashes and generic-media compatibility are **not** physical approval.
5. After owner-led physical verification in rollout follow-up [#32](https://github.com/WhatTheStackConf/wts/issues/32), an admin may explicitly attest to printed legibility, bounds and gap feed for this exact printer/stock/version. Approval requires a reason, bounded evidence note and a separate confirmation checkbox. This action records evidence; it does not print anything or enable the unfinished event workflow.

Configuration and approval commands retain their complete UUID/payload across a lost or unreadable response. Retry **the same profile action** to resolve it. A catalogue refresh cannot silently change its expected versions or note. Conflicts require refreshing and selecting a new intention, not blindly resubmitting a new UUID.

## Rendering contract

- `src/lib/checkin-label-render-contract.ts` is browser-safe. `src/lib/checkin-label-renderer.ts` is server-only.
- `renderNameLabel` takes explicit text, exact profile snapshot, preview/production mode, and expected profile/printer/stock/software identities. Production mode refuses missing, mismatched, unapproved or synthetic profiles. This is a rendering gate, **not print authorization**: future attempt creation and pre-start must also revalidate live station/system/agent authority and approved current profile. There is no production-print HTTP operation in this slice.
- Software identity: `wts-name-label-v1`. Pinned font identity: `noto-sans-2.008-latin-cyrillic-v1`. Fontkit is pinned exactly; the lockfile pins the raster dependencies. The licensed Regular/Bold Noto Sans assets and source revision/hashes are documented in `public/fonts/checkin-label/README.md`. Embedded font bytes ship with the server bundle, are checked before use, and require no runtime filesystem path or font download.
- Exactly two row slots: bold name at **64→32 dots**, regular affiliation at **28→20 dots**. Each row shrinks independently one dot at a time, then removes whole grapheme clusters and appends `…`. Name remains larger than affiliation even at its minimum. These are renderer limits, not a claim of physically readable millimetres without calibration.
- Font shaping supports Latin/Macedonian Cyrillic, mixed scripts, ordinary punctuation, combining accents and descenders. Missing glyphs fail closed; no fallback or third row. Unsupported input, leading/trailing/repeated spaces, controls, email and capability/QR-shaped strings are rejected rather than silently repaired.
- Fixed nominal stock is **50×30 mm pre-cut gap**. Raster size, printable bounds, margins, offsets and feed are explicit **device dots**; there is no DPI or mm-to-dot conversion. The synthetic **600×360** raster establishes no printer calibration. Historical 40×20 mm / 384×120 settings are not implicitly approved.
- Geometry is defined before clockwise raster rotation. 90°/270° swap output width/height. Offsets translate the inset text box without crossing printable bounds. Density and feed are downstream device instructions carried in identity, not silently simulated physical effects. Threshold controls actual monochrome rasterization.
- The result freezes full original text/profile/software inputs, fitted rows, PNG bytes and a SHA-256 payload identity covering snapshot, fitting decisions and actual raster hash. Identical inputs produce identical output on the pinned runtime. Shortened inputs remain distinct identities even if their visible PNGs match.

## Persistence and privacy

`checkin_label_profiles` keeps immutable configuration versions. `checkin_label_approvals` keeps separate immutable approval evidence. An Admin Action and the corresponding check-in audit record commit atomically with each accepted mutation. Actor, operation, reason, note and versioned configuration are auditable; read/preview operations create neither admission nor print intent and do not retain attendee text.

Effective approval fails closed when the current station configuration no longer matches the recorded version/printer identity. The latest profile is used for new work; historical configurations remain accessible for exact administrative previews, never automatic retargeting of old attempts.

All browser commands use same-origin JSON POST and bounded bodies, private/no-store responses, no-referrer and the existing check-in CSP/privacy boundary. Only name and affiliation enter label text; no attendee email, QR payload or upstream capability enters the label snapshot or PNG metadata. Rendering uses memory only: there is no spool file to clean up. No attendee text is written to profile/audit records or logs. Future durable print attempts must apply the parent specification's retention/purge policy; this slice does not claim backup-retention or physical-device readiness.

## Verification

The default `pnpm test` explicitly registers the renderer, profile-PocketBase and HTTP suites. `pnpm test:checkin-browser` discovers the actual admin UI scenarios through its existing disposable production server runner; no production credentials or normal PocketBase data are needed. Font/raster tests decode real output and verify row fitting, glyphs, bounds, rotation, deterministic identity and fail-closed errors. Browser tests inspect canvas pixels and retain mobile/raster screenshots for visual review.

Run the manifest's `test`, `check`, `typecheck`, `build` and `test:checkin-browser` gates. See [checkin-verification.md](checkin-verification.md) for isolation and execution evidence. Physical legibility, feed/calibration, Pi/native runtime and owner event-use approval remain separate rollout work.

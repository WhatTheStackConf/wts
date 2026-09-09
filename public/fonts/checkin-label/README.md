# Pinned Name Label fonts

Noto Sans **2.008**, Regular (affiliation) and Bold (name), under the bundled [SIL Open Font License 1.1](LICENSE).

Source revision: [`notofonts/noto-fonts@ffebf8c1ee449e544955a7e813c54f9b73848eac`](https://github.com/notofonts/noto-fonts/tree/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans).

| Asset | SHA-256 |
| --- | --- |
| `NotoSans-Regular.ttf` | `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5` |
| `NotoSans-Bold.ttf` | `c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a` |

The corresponding unmodified bytes are embedded as base64 in `src/lib/checkin-label-render-font-data.ts`. This keeps the production server independent of its working directory and of runtime font downloads. The renderer verifies the hashes, TrueType format and required Latin/Macedonian Cyrillic coverage before use; there is no system-font fallback. Tests compare embedded bytes to these source assets.

The font identity is `noto-sans-2.008-latin-cyrillic-v1`. Changing font bytes or fitting/raster behavior requires a new font/renderer identity and new profile approval; never replace bytes under a previously approved identity. Keep this license with both forms of the font.

Browser preview displays the exact font-backed PNG produced on the server, not a second browser-font approximation. Screen output, synthetic dimensions and matching hashes do not establish printed legibility or printer/media calibration.

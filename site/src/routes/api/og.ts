import satori from "satori";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import {
  conferenceDefaultOgSubtitle,
  conferenceName,
} from "~/lib/conference-guide-content";
const require = createRequire(import.meta.url);
let fontStar: ArrayBuffer | null = null;
let logoPngDataUri: string | null = null;

async function ensureAssets() {
  const publicDir = process.env.SITE_PUBLIC_DIR || resolve(process.cwd(), "public");
  if (!fontStar) {
    const font = await readFile(resolve(publicDir, "fonts/starzoom-shavian.regular.ttf"));
    fontStar = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer;
  }
  if (!logoPngDataUri) {
    const logo = await readFile(resolve(publicDir, "favicon.svg"));
    const png = await sharp(logo).resize(80, 100).png().toBuffer();
    logoPngDataUri = `data:image/png;base64,${png.toString("base64")}`;
  }
}

export async function GET({ request }: { request: Request }) {
  const url = new URL(request.url);
  const title = url.searchParams.get("title") || conferenceName;
  const subtitle =
    url.searchParams.get("subtitle") || conferenceDefaultOgSubtitle;

  // HarfBuzz's Emscripten Node loader needs its CommonJS __dirname to find WASM.
  await require("harfbuzzjs");
  await ensureAssets();

  const fonts: any[] = [];
  if (fontStar) {
    fonts.push({
      name: "StarzoomShavian",
      data: fontStar,
      weight: 400 as const,
      style: "normal" as const,
    });
  }

  const titleFont = "StarzoomShavian";

  const svg = await satori(
    {
      type: "div",
      key: null,
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#111a33",
          position: "relative",
          overflow: "hidden",
        },
        children: [
          // Gradient overlay 1
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                background:
                  "radial-gradient(circle at 20% 30%, #22375a 0%, transparent 50%)",
                display: "flex",
              },
            },
          },
          // Gradient overlay 2
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                background:
                  "radial-gradient(circle at 80% 70%, #32465b 0%, transparent 50%)",
                display: "flex",
              },
            },
          },
          // Top accent line
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "4px",
                background:
                  "linear-gradient(to right, #55c6d8, #f0b35a, #55c6d8)",
                display: "flex",
              },
            },
          },
          // Bottom accent line
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                bottom: 0,
                left: 0,
                width: "100%",
                height: "4px",
                background:
                  "linear-gradient(to right, #f0b35a, #55c6d8, #f0b35a)",
                display: "flex",
              },
            },
          },
          // Corner TL
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: "20px",
                left: "20px",
                width: "40px",
                height: "40px",
                borderLeft: "2px solid #f0b35a",
                borderTop: "2px solid #f0b35a",
                display: "flex",
              },
            },
          },
          // Corner TR
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: "20px",
                right: "20px",
                width: "40px",
                height: "40px",
                borderRight: "2px solid #55c6d8",
                borderTop: "2px solid #55c6d8",
                display: "flex",
              },
            },
          },
          // Corner BL
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                bottom: "20px",
                left: "20px",
                width: "40px",
                height: "40px",
                borderLeft: "2px solid #55c6d8",
                borderBottom: "2px solid #55c6d8",
                display: "flex",
              },
            },
          },
          // Corner BR
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                bottom: "20px",
                right: "20px",
                width: "40px",
                height: "40px",
                borderRight: "2px solid #f0b35a",
                borderBottom: "2px solid #f0b35a",
                display: "flex",
              },
            },
          },
          // Content
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                height: "100%",
                padding: "50px 60px",
                gap: "12px",
              },
              children: [
                // Logo
                ...(logoPngDataUri
                  ? [
                      {
                        type: "img",
                        props: {
                          src: logoPngDataUri,
                          width: 60,
                          height: 76,
                          style: { display: "flex" },
                        },
                      },
                    ]
                  : []),
                // Title
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      fontSize: title.length > 30 ? "48px" : "64px",
                      color: "white",
                      fontFamily: titleFont,
                      fontWeight: 900,
                      letterSpacing: "0.05em",
                      textAlign: "center",
                      lineHeight: 1.1,
                    },
                    children: title.toUpperCase(),
                  },
                },
                // Subtitle
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      fontSize: "24px",
                      color: "#b9c8d9",
                      fontFamily: titleFont,
                      letterSpacing: "0.15em",
                      textAlign: "center",
                    },
                    children: subtitle.toUpperCase(),
                  },
                },
                // CTA
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      marginTop: "16px",
                      padding: "12px 32px",
                      background:
                        "linear-gradient(to right, #55c6d8, #f0b35a)",
                      borderRadius: "999px",
                      fontSize: "20px",
                      fontFamily: titleFont,
                      fontWeight: 700,
                      color: "#111a33",
                      letterSpacing: "0.1em",
                    },
                    children: "GET UPDATES AT WTS.SH",
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts,
    }
  );

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const body = Uint8Array.from(png);

  return new Response(body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}

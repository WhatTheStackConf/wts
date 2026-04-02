import satori from "satori";
import sharp from "sharp";
import { readFileSync } from "fs";
import { join } from "path";
let fontRegular: ArrayBuffer | null = null;
let fontStar: ArrayBuffer | null = null;

async function ensureFonts() {
  if (!fontRegular) {
    try {
      const res = await fetch(
        "https://fonts.gstatic.com/s/spacegrotesk/v22/V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj4PVksj.ttf"
      );
      fontRegular = await res.arrayBuffer();
    } catch (e) {
      console.error("Failed to fetch Space Grotesk font:", e);
    }
  }
  if (!fontStar) {
    try {
      fontStar = readFileSync(
        join(process.cwd(), "public/fonts/starzoom-shavian.regular.ttf")
      ).buffer as ArrayBuffer;
    } catch (e) {
      console.error("Failed to load StarzoomShavian font:", e);
    }
  }
}

export async function GET({ request }: { request: Request }) {
  const url = new URL(request.url);
  const title = url.searchParams.get("title") || "WhatTheStack 2026";
  const subtitle =
    url.searchParams.get("subtitle") || "September 19th // Skopje, MK";

  await ensureFonts();

  const fonts: any[] = [];
  if (fontRegular) {
    fonts.push({
      name: "Space Grotesk",
      data: fontRegular,
      weight: 400 as const,
      style: "normal" as const,
    });
  }
  if (fontStar) {
    fonts.push({
      name: "StarzoomShavian",
      data: fontStar,
      weight: 400 as const,
      style: "normal" as const,
    });
  }

  const titleFont = fontStar ? "StarzoomShavian" : "Space Grotesk";

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#070514",
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
                  "radial-gradient(circle at 20% 30%, #1a1035 0%, transparent 50%)",
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
                  "radial-gradient(circle at 80% 70%, #2d0a2e 0%, transparent 50%)",
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
                  "linear-gradient(to right, #ff00ff, #00ffff, #ff00ff)",
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
                  "linear-gradient(to right, #00ffff, #ff00ff, #00ffff)",
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
                borderLeft: "2px solid #ff00ff",
                borderTop: "2px solid #ff00ff",
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
                borderRight: "2px solid #00ffff",
                borderTop: "2px solid #00ffff",
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
                borderLeft: "2px solid #00ffff",
                borderBottom: "2px solid #00ffff",
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
                borderRight: "2px solid #ff00ff",
                borderBottom: "2px solid #ff00ff",
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
                padding: "60px",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      fontSize: title.length > 30 ? "52px" : "72px",
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
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      fontSize: "28px",
                      color: "#d4a0d4",
                      fontFamily: "Space Grotesk",
                      letterSpacing: "0.15em",
                      textAlign: "center",
                      marginTop: "16px",
                    },
                    children: subtitle.toUpperCase(),
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

  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}

import { defineConfig, s } from "velite";

export default defineConfig({
    strict: true,
    root: "content",
    output: {
        data: ".velite",
        assets: "public/static",
        base: "/static/",
        name: "[name]-[hash:6].[ext]",
        clean: true,
    },
    collections: {
        conferenceGuide: {
            name: "ConferenceGuide",
            pattern: "conference-guide.json",
            single: true,
            schema: s.strictObject({
                schemaVersion: s.literal("1"),
                contentVersion: s.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                event: s.strictObject({
                    name: s.string().min(1),
                    date: s.strictObject({
                        status: s.literal("announced"),
                        localDate: s.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                    }),
                    location: s.strictObject({
                        status: s.literal("announced"),
                        city: s.string().min(1),
                        country: s.string().min(1),
                    }),
                    timeZone: s.strictObject({
                        status: s.literal("announced"),
                        iana: s.literal("Europe/Skopje"),
                    }),
                }),
                mainVenue: s.strictObject({
                    status: s.literal("not_announced"),
                }),
                preConferenceVenue: s.strictObject({
                    status: s.literal("announced"),
                    name: s.string().min(1),
                    address: s.string().min(1),
                }),
                tickets: s.strictObject({
                    status: s.literal("announced"),
                    canonicalPath: s.string().regex(/^\/[a-z0-9/-]*$/),
                    regular: s.strictObject({
                        amount: s.number().int().positive(),
                        currency: s.literal("EUR"),
                    }),
                    student: s.strictObject({
                        amount: s.number().int().positive(),
                        currency: s.literal("EUR"),
                        verificationEmail: s.string().email(),
                    }),
                    includes: s.array(s.string().min(1)).min(1),
                    workshops: s.literal("separate_add_on"),
                }),
                codeOfConduct: s.strictObject({
                    status: s.literal("announced"),
                    canonicalPath: s.string().regex(/^\/[a-z0-9/-]*$/),
                    reportingEmail: s.string().email(),
                }),
                accessibility: s.strictObject({
                    status: s.literal("not_announced"),
                    contactEmail: s.string().email(),
                }),
                accommodation: s.strictObject({
                    status: s.literal("not_announced"),
                }),
                contact: s.strictObject({
                    generalEmail: s.string().email(),
                }),
            }),
        },
        pages: {
            name: "Page",
            pattern: "pages/**/*.{md,mdx}",
            schema: s
                .object({
                    title: s.string(),
                    slug: s.slug("pages"),
                    content: s.mdx(),
                })
                .transform((data) => ({ ...data, permalink: `/${data.slug}` })),
        },
        posts: {
            name: "Post",
            pattern: "blog/**/*.md",
            schema: s
                .object({
                    title: s.string(),
                    slug: s.slug("blog"),
                    date: s.isodate(),
                    excerpt: s.string().optional(),
                    author: s.string().default("WhatTheStack Team"),
                    content: s.mdx(),
                })
                .transform((data) => ({
                    ...data,
                    permalink: `/blog/${data.slug}`,
                })),
        },
    },
    mdx: {
        jsxImportSource: "solid-jsx",
    },
});

import { defineConfig, s } from "velite";

export default defineConfig({
    root: "content",
    output: {
        data: ".velite",
        assets: "public/static",
        base: "/static/",
        name: "[name]-[hash:6].[ext]",
        clean: true,
    },
    collections: {
        pages: {
            name: "Page",
            pattern: "pages/**/*.md",
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

import { useParams, type RouteDefinition } from "@solidjs/router";
import { httpStatus } from "@solidjs/web";
import { createMemo, Show } from "solid-js";
import { PublicPageShell } from "~/components/PublicPageShell";
import { MDXContent } from "~/components/MDXContent";
import { pages } from "~/lib/markdown-pages";
import NotFound from "./[...404]";

export const route = {
    preload: ({ params }) => {
        if (!pages.some((page) => page.slug === params.slug)) httpStatus(404);
    },
} satisfies RouteDefinition;

export default function Page() {
    const params = useParams();

    const page = createMemo(() => {
        return pages.find((p) => p.slug === params.slug);
    });

    return (
        <Show when={page()} fallback={<NotFound />}>
            <PublicPageShell
                title={page()!.title}
                description={`Read ${page()!.title} from WhatTheStack.`}
            >
                <article class="support-prose">
                    <MDXContent code={page()!.content} />
                </article>
            </PublicPageShell>
        </Show>
    );
}

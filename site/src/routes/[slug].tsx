import { useParams, type RouteDefinition } from "@solidjs/router";
import { httpStatus, type JSX } from "@solidjs/web";
import { createMemo, Show } from "solid-js";
import { PublicPageShell, SupportBand } from "~/components/PublicPageShell";
import { MDXContent } from "~/components/MDXContent";
import { pages } from "~/lib/markdown-pages";
import NotFound from "./[...404]";

export const route = {
    preload: ({ params }) => {
        if (!pages.some((page) => page.slug === params.slug)) httpStatus(404);
    },
} satisfies RouteDefinition;

const sectionNumber = /^(\d+)\.\s+/;

// The band renders the page title, so the Markdown h1 would repeat it.
const BandTitle = () => null;

function SectionHeading(props: { children?: JSX.Element }) {
    const match = () => (typeof props.children === "string" ? sectionNumber.exec(props.children) : null);
    return (
        <h3 data-index={match()?.[1].padStart(2, "0")}>
            {match() ? (props.children as string).slice(match()![0].length) : props.children}
        </h3>
    );
}

const proseComponents = { h1: BandTitle, h3: SectionHeading };

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
                <SupportBand altitude={1} label="WTS 2027 · Policy">
                    <h1 class="support-band-title">{page()!.title}</h1>
                </SupportBand>
                <article class="support-prose">
                    <MDXContent code={page()!.content} components={proseComponents} />
                </article>
            </PublicPageShell>
        </Show>
    );
}

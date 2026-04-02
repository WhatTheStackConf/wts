import { useParams, useNavigate } from "@solidjs/router";
import { createMemo, Show, onMount } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { MDXContent } from "~/components/MDXContent";
import { pages } from ".velite";
import NotFound from "./[...404]";

export default function Page() {
    const params = useParams();

    const page = createMemo(() => {
        return pages.find((p) => p.slug === params.slug);
    });

    return (
        <Show when={page()} fallback={<NotFound />}>
            <Layout
                title={page()!.title}
                description={`Read our ${page()!.title}`}
            >
                <div class="w-full h-full px-4 relative pt-4 md:pt-24 pb-20">
                    <div class="max-w-4xl mx-auto relative z-20">
                        <div class="glass-panel p-6 md:p-12 rounded-2xl fade-in-delay-1 relative z-30">
                            <MDXContent code={page()!.content} />
                        </div>
                    </div>
                </div>
            </Layout>
        </Show>
    );
}

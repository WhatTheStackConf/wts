import { useParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { MDXContent } from "~/components/MDXContent";
import { posts } from ".velite";
import NotFound from "../[...404]";

export default function BlogPost() {
  const params = useParams();

  const post = createMemo(() => posts.find((p) => p.slug === params.slug));

  return (
    <Show when={post()} fallback={<NotFound />}>
      <Layout
        title={`${post()!.title} — WhatTheStack 2026`}
        description={post()!.excerpt || `Read ${post()!.title}`}
      >
        <div class="w-full h-full px-4 relative pt-4 md:pt-24 pb-20">
          <div class="max-w-4xl mx-auto relative z-20">
            <div class="mb-8 fade-in">
              <a
                href="/blog"
                class="text-sm text-primary-400 hover:text-primary-300 font-mono transition-colors"
              >
                &larr; Back to blog
              </a>
            </div>

            <div class="glass-panel p-6 md:p-12 rounded-2xl fade-in-delay-1 relative z-30">
              <div class="mb-8">
                <time class="text-sm text-secondary-500 font-mono">
                  {new Date(post()!.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </time>
                <span class="text-primary-200/40 text-sm ml-4">
                  By {post()!.author}
                </span>
              </div>

              <MDXContent code={post()!.content} />
            </div>
          </div>
        </div>
      </Layout>
    </Show>
  );
}

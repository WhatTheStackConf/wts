import { For } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { posts } from ".velite";

export default function Blog() {
  const sortedPosts = () =>
    [...posts].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

  return (
    <Layout
      title="Blog — WhatTheStack 2026"
      description="Behind the scenes of running an 800+ attendee developer conference in Skopje."
    >
      <div class="w-full h-full px-4 relative pt-4 md:pt-24 pb-20">
        <div class="max-w-4xl mx-auto relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-4 text-center neon-glow fade-in">
            Blog
          </h1>
          <p class="text-center text-primary-200/70 mb-12 fade-in-delay-1">
            Behind the scenes of building WhatTheStack 2026
          </p>

          <div class="space-y-6 fade-in-delay-2">
            <For each={sortedPosts()}>
              {(post) => (
                <a
                  href={post.permalink}
                  class="block glass-panel p-6 md:p-8 rounded-2xl hover:border-primary-500/50 transition-all duration-300 group"
                >
                  <div class="flex flex-col gap-2">
                    <time class="text-sm text-secondary-500 font-mono">
                      {new Date(post.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </time>
                    <h2 class="text-xl md:text-2xl font-bold text-white group-hover:text-primary-400 transition-colors">
                      {post.title}
                    </h2>
                    {post.excerpt && (
                      <p class="text-primary-200/60 mt-1">{post.excerpt}</p>
                    )}
                    <span class="text-sm text-primary-200/40 mt-2">
                      By {post.author}
                    </span>
                  </div>
                </a>
              )}
            </For>
          </div>
        </div>
      </div>
    </Layout>
  );
}

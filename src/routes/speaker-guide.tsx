import { useSearchParams } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import { MDXContent } from "~/components/MDXContent";
import { fetchSpeakerGuide } from "~/lib/speaker-guide";
import { Layout } from "~/layouts/Layout";

export default function SpeakerGuide() {
  const [searchParams] = useSearchParams();
  const [guide] = createResource(
    () => (typeof searchParams.pw === "string" ? searchParams.pw : ""),
    fetchSpeakerGuide,
  );

  return (
    <Layout title="Speaker Guide" description="Speaker guide for WhatTheStack 2026">
      <div class="w-full h-full px-4 relative pt-4 md:pt-24 pb-20">
        <div class="max-w-4xl mx-auto relative z-20">
          <Show
            when={!guide.loading}
            fallback={<div class="glass-panel p-6 md:p-12 rounded-2xl">Loading...</div>}
          >
            <Show
              when={guide()}
              fallback={<div class="glass-panel p-6 md:p-12 rounded-2xl">Unauthorized</div>}
            >
              {(content) => (
                <div class="glass-panel p-6 md:p-12 rounded-2xl fade-in-delay-1 relative z-30">
                  <MDXContent code={content().content} />
                </div>
              )}
            </Show>
          </Show>
        </div>
      </div>
    </Layout>
  );
}

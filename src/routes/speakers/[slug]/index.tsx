import { useParams } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { fetchSpeakerBySlug } from "~/lib/speakers-public";
import { SpeakerAvatar } from "~/components/conference/SpeakerAvatar";
import { SocialLinks } from "~/components/conference/SocialLinks";
import { proseArticleClasses } from "~/components/MDXContent";
import NotFound from "../../[...404]";

export default function SpeakerDetail() {
  const params = useParams();
  const [speaker] = createResource(
    () => params.slug,
    (slug) => fetchSpeakerBySlug(slug),
  );

  return (
    <Show
      when={!speaker.loading}
      fallback={
        <div class="flex justify-center py-32">
          <span class="loading loading-bars loading-lg text-primary-500" />
        </div>
      }
    >
      <Show when={speaker()} fallback={<NotFound />}>
        {(s) => (
          <Layout
            title={`${s().displayName} — WhatTheStack 2026`}
            description={s().affiliation || `Speaker at WhatTheStack 2026`}
          >
            <div class="w-full h-full px-4 relative pt-4 md:pt-12 pb-20">
              <div class="max-w-4xl mx-auto relative z-20">
                <div class="glass-panel p-6 md:p-12 rounded-2xl fade-in-delay-1 relative z-30">
                  <header class="mb-8 md:mb-10">
                    <div class="flex flex-col sm:flex-row gap-6 sm:gap-8 items-start">
                      <SpeakerAvatar
                        name={s().displayName}
                        photoUrl={s().photoUrl}
                        size="xl"
                        class="mx-auto sm:mx-0"
                      />
                      <div class="flex-1 min-w-0 w-full text-center sm:text-left">
                        <Show when={s().affiliation}>
                          <p class="text-sm text-secondary-500 font-mono mb-2">
                            {s().affiliation}
                          </p>
                        </Show>
                        <h1 class="font-star text-3xl md:text-4xl lg:text-5xl font-bold text-secondary-400 leading-tight text-balance">
                          {s().displayName}
                        </h1>
                        <div class="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-center sm:justify-start">
                          <SocialLinks handles={s().socialHandles} />
                        </div>
                      </div>
                    </div>
                  </header>

                  <Show when={s().bio}>
                    <div class={proseArticleClasses} innerHTML={s().bio} />
                  </Show>

                  <section
                    class={
                      s().bio
                        ? "mt-10 pt-8 border-t border-white/10"
                        : undefined
                    }
                  >
                    <h2 class="text-xl md:text-2xl font-bold text-white mb-6">
                      Sessions
                    </h2>
                    <Show
                      when={s().sessions.length > 0}
                      fallback={
                        <p class="text-primary-200/60 italic">
                          Session details coming soon.
                        </p>
                      }
                    >
                      <ul class="space-y-4 list-none p-0 m-0">
                        <For each={s().sessions}>
                          {(session) => (
                            <li>
                              <a
                                href={`/sessions/${session.slug}`}
                                class="block glass-panel p-6 md:p-8 rounded-2xl hover:border-primary-500/50 transition-all duration-300 group"
                              >
                                <h3 class="text-lg md:text-xl font-bold text-white group-hover:text-primary-400 transition-colors">
                                  {session.title}
                                </h3>
                                <Show when={session.format}>
                                  <p class="text-sm text-secondary-500 font-mono mt-2">
                                    {session.format}
                                  </p>
                                </Show>
                              </a>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  </section>
                </div>
              </div>
            </div>
          </Layout>
        )}
      </Show>
    </Show>
  );
}

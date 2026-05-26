import { useParams } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { fetchSpeakerBySlug } from "~/lib/speakers-public";
import { SpeakerAvatar } from "~/components/conference/SpeakerAvatar";
import { SocialLinks } from "~/components/conference/SocialLinks";
import { proseArticleClasses } from "~/components/MDXContent";
import NotFound from "../[...404]";

function sessionLabel(count: number) {
  if (count === 0) return "Sessions soon";
  if (count === 1) return "1 session on programme";
  return `${count} sessions on programme`;
}

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
                  <header class="flex flex-col md:flex-row gap-8 md:gap-10 items-center md:items-start mb-8 md:mb-10">
                    <SpeakerAvatar
                      name={s().displayName}
                      photoUrl={s().photoUrl}
                      size="xl"
                    />
                    <div class="flex-1 min-w-0 text-center md:text-left">
                      <div class="mb-4 md:mb-6">
                        <span class="text-sm text-secondary-500 font-mono">
                          {sessionLabel(s().sessionCount)}
                        </span>
                        <Show when={s().affiliation}>
                          <span class="text-primary-200/40 text-sm block md:inline mt-1 md:mt-0 md:ml-4">
                            {s().affiliation}
                          </span>
                        </Show>
                      </div>
                      <h1 class="font-star text-3xl md:text-4xl lg:text-5xl font-bold text-secondary-400 leading-tight">
                        {s().displayName}
                      </h1>
                      <div class="mt-5">
                        <SocialLinks handles={s().socialHandles} variant="inline" />
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

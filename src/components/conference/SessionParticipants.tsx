import { For, Show } from "solid-js";
import type { PublicSpeakerSummary } from "~/lib/conference-public";
import { SpeakerAvatar } from "~/components/conference/SpeakerAvatar";

interface ParticipantListProps {
  people: PublicSpeakerSummary[];
  label: string;
}

function ParticipantList(props: ParticipantListProps) {
  return <ul class="grid grid-cols-1 sm:grid-cols-2 gap-4 list-none p-0 m-0" role="list" aria-label={props.label}>
    <For each={props.people}>{(speaker) => (
      <li>
        <a href={`/speakers/${speaker.slug}`} class="flex items-center gap-4 glass-panel p-4 md:p-5 rounded-2xl hover:border-primary-500/50 transition-all duration-300 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60">
          <SpeakerAvatar name={speaker.displayName} photoUrl={speaker.photoUrl} size="sm" />
          <span class="min-w-0">
            <span class="block font-bold text-white group-hover:text-primary-400 transition-colors [overflow-wrap:anywhere]">{speaker.displayName}</span>
            <Show when={speaker.affiliation}>
              <span class="block text-xs text-secondary-500 [overflow-wrap:anywhere]">{speaker.affiliation}</span>
            </Show>
          </span>
        </a>
      </li>
    )}</For>
  </ul>;
}

interface SessionParticipantsProps {
  speakers: PublicSpeakerSummary[];
  hosts?: PublicSpeakerSummary[];
}

export function SessionParticipants(props: SessionParticipantsProps) {
  const guests = () => props.speakers.filter((speaker) => !props.hosts?.some((host) => host.slug === speaker.slug));
  return <>
    <section class="mt-10 pt-8 border-t border-white/10" aria-label="Session speakers">
      <h2 class="text-xl md:text-2xl font-bold text-white mb-6">Speakers</h2>
      <Show when={guests().length > 0} fallback={<p class="text-primary-200/60 italic">Speakers haven't been announced for this session yet.</p>}>
        <ParticipantList people={guests()} label="Speakers" />
      </Show>
    </section>
    <Show when={props.hosts?.length}>
      <section class="mt-8 pt-6 border-t border-white/20" aria-label="Session hosts" data-session-hosts>
        <h2 class="text-xl md:text-2xl font-bold text-white mb-6">{props.hosts?.length === 1 ? "Host" : "Hosts"}</h2>
        <ParticipantList people={props.hosts || []} label="Hosts" />
      </section>
    </Show>
  </>;
}

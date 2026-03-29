// src/components/NightridePlayerInner.tsx
import {
  createSignal,
  For,
  onCleanup,
  createEffect,
  Show,
  onMount,
} from "solid-js";

const STATIONS = [
  {
    id: "nightride",
    name: "Nightride",
    url: "https://stream.nightride.fm/nightride.m4a",
  },
  {
    id: "chillsynth",
    name: "Chillsynth",
    url: "https://stream.nightride.fm/chillsynth.m4a",
  },
  {
    id: "darksynth",
    name: "Darksynth",
    url: "https://stream.nightride.fm/darksynth.m4a",
  },
];

export default function NightridePlayerInner() {
  const [playing, setPlaying] = createSignal(false);
  const [station, setStation] = createSignal(STATIONS[0]);
  const [tick, setTick] = createSignal(0);
  const [showStations, setShowStations] = createSignal(false);
  const [nowPlaying, setNowPlaying] = createSignal({
    artist: "NIGHTRIDE",
    title: "RADIO",
  });

  let audio: HTMLAudioElement;
  let frameId: number;

  // Helper to parse the Nightride specific data format
  const handleUpdate = (data: any) => {
    // Nightride often wraps the station update in an array: [{station: '...', ...}]
    const update = Array.isArray(data)
      ? data.find((item: any) => item.station === station().id)
      : data.station === station().id
        ? data
        : null;

    if (update) {
      const artist = (update.artist || "Nightride").toUpperCase();
      const title = (update.title || "FM").toUpperCase();
      setNowPlaying({ artist, title });
    }
  };

  onMount(() => {
    const updateMetadata = async () => {
      try {
        const res = await fetch(`/api/nr-metadata?stationId=${station().id}`);
        const json = await res.json();
        if (json.title) {
          setNowPlaying({
            artist: json.artist.toUpperCase(),
            title: json.title.toUpperCase(),
          });
        }
      } catch (e) {
        console.error("Metadata refresh failed");
      }
    };

    // Initial load
    updateMetadata();

    // Refresh every 20 seconds
    const interval = setInterval(updateMetadata, 20000);

    onCleanup(() => clearInterval(interval));
  });

  const animate = () => {
    setTick((t) => t + 1);
    frameId = requestAnimationFrame(animate);
  };

  createEffect(() => {
    playing() ? animate() : cancelAnimationFrame(frameId);
  });

  onCleanup(() => cancelAnimationFrame(frameId));

  const toggle = () => {
    playing() ? audio!.pause() : audio!.play();
    setPlaying(!playing());
  };

  return (
    <div class="fixed bottom-4 left-4 right-4 md:right-auto md:w-80 z-[9999] flex flex-col gap-1">
      <Show when={showStations()}>
        <div class="bg-black border border-pink-500/30 p-1 flex flex-col mb-1 shadow-2xl backdrop-blur-md">
          <For each={STATIONS}>
            {(s) => (
              <button
                onClick={() => {
                  setStation(s);
                  setShowStations(false);
                  setPlaying(false);
                }}
                class={`text-left px-3 py-2 text-[10px] font-mono transition-all ${station().id === s.id ? "bg-pink-500 text-black" : "text-zinc-400 hover:text-pink-400"}`}
              >
                {s.name.toUpperCase()}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="flex items-center gap-3 bg-zinc-950/95 border-l-4 border-pink-500 p-3 shadow-2xl backdrop-blur-xl">
        <audio ref={audio!} src={station().url} crossorigin="anonymous" />

        <button
          onClick={toggle}
          class="flex h-10 w-10 shrink-0 items-center justify-center border border-pink-500/40 bg-pink-500/5 text-pink-500"
        >
          {playing() ? "■" : "▶"}
        </button>

        <div
          class="flex flex-col min-w-0 overflow-hidden grow cursor-pointer"
          onClick={() => setShowStations(!showStations())}
        >
          <span class="text-[9px] uppercase tracking-widest text-pink-500 font-bold">
            {station().name} FM {showStations() ? "▼" : "▲"}
          </span>
          <div class="text-[11px] font-mono text-zinc-100 truncate">
            {nowPlaying().artist} — {nowPlaying().title}
          </div>
        </div>

        <div class="flex items-end gap-0.5 h-5 pr-1">
          <For each={[0.8, 0.4, 0.9, 0.6]}>
            {(multiplier) => (
              <div
                class="w-1 bg-pink-500 transition-all duration-75"
                style={{
                  height: playing()
                    ? `${Math.max(20, 40 + Math.sin(tick() * 0.15 * multiplier) * 60)}%`
                    : "15%",
                }}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

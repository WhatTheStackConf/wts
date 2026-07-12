import { For } from "solid-js";

const codeSnippets = [
  "function replicant() { return 'More human than human'; }",
  "const future = new Date(2026, 8, 19); // WhatTheStack date confirmed",
  "if (isReplicant) { console.log('Retire'); } else { console.log('Live free'); }",
  "const neon = 'rgb(255, 0, 255)'; // Cyberpunk pink",
  "for (let i = 0; i < stack.length; i++) { console.log(stack[i]); }",
  "const WTSTheme = { year: 2026, theme: 'Blade Runner' };",
  "function deploy() { return 'To the future'; }",
  "const conference = { name: 'WhatTheStack', vibe: 'neon' };",
  "const replicant = { type: 'Nexus-7', status: 'on-the-run' };",
  "if (memory) { return false; } // Replicant memories are implanted",
  "const spinner = { direction: 'up', destination: 'Tyrell Corp' };",
  "const origami = { animal: 'origami', creator: 'Sapper' };",
  "const bladerunner = { target: 'replicant', weapon: 'pistol' };",
  "const data = { eyes: 'blue', density: 'light' }; // VOIGHT-KAMPFF test",
  "const dystopia = { weather: 'rain', season: 'perpetual night' };",
  "const digitalRain = [...Array(20)].map(() => Math.random());",
  "const cyberpunk = { city: 'Skopje', year: 2049 };",
  "const code = { language: 'Assembly', origin: 'Tyrell Corp' };",
  "const server = { location: 'Off-world colony', security: 'high' };",
  "const stack = { tech: ['Solid.js', 'Node.js', 'WebAssembly'], future: 'bright' };",
  "const webAssembly = 'The future of web development';",
  "const nodejs = 'Running JavaScript everywhere';",
  "const javascript = { goodParts: false, es6: true, future: 'bright' };",
  "const ai = { consciousness: 'simulated', empathy: 'questionable' };",
];

function TypingCode(props: { snippet: string; index: number }) {
  return <div>{props.snippet}</div>;
}

export default function CodeBackground() {
  return (
    <div class="absolute inset-0 overflow-hidden z-19" aria-hidden="true" inert>
      {/* Scrolling code lines */}
      <For each={Array.from({ length: 15 })}>
        {(item, i) => {
          const index = i();
          const fontSize = index % 4 === 0 ? "text-sm" : "text-xs";
          const colors = [
            "text-green-400",
            "text-cyan-400",
            "text-primary-500",
            "text-secondary-300",
          ];
          const color = colors[index % colors.length];

          return (
            <div
              class={`absolute whitespace-nowrap font-mono ${fontSize} ${color}`}
              style={{
                top: `${(index * 37 + 11) % 100}%`,
                left: `${(index * 7 + 3) % 20}%`,
                animation: `scroll-horizontal ${12 + (index * 7) % 18}s linear infinite`,
                "animation-delay": `${(index * 11) % 5}s`,
              }}
            >
              {codeSnippets[(index * 5 + 3) % codeSnippets.length]}
            </div>
          );
        }}
      </For>

      {/* Typing code lines */}
      <For each={Array.from({ length: 8 })}>
        {(item, i) => {
          const index = i();
          const fontSize = index % 2 === 0 ? "text-sm" : "text-xs";
          const colors = [
            "text-cyan-400",
            "text-green-400",
            "text-primary-500",
            "text-secondary-400",
          ];
          const color = colors[index % colors.length];

          return (
            <div
              class={`absolute whitespace-nowrap font-mono ${fontSize} ${color}`}
              style={{
                top: `${20 + (index * 17) % 60}%`,
                left: `${5 + (index * 3) % 10}%`,
                "animation-delay": `${index % 3}s`,
              }}
            >
              <TypingCode
                snippet={codeSnippets[index % codeSnippets.length]}
                index={index}
              />
            </div>
          );
        }}
      </For>
    </div>
  );
}

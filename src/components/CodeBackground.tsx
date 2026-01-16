import { For, createSignal, onMount } from "solid-js";

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
  const [text, setText] = createSignal("");
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [loopNum, setLoopNum] = createSignal(0);

  onMount(() => {
    const typingSpeed = 100 + props.index * 20;
    const deletingSpeed = 50 + props.index * 10;
    const pauseTime = 2000 + props.index * 300;

    const type = () => {
      const current = loopNum() % codeSnippets.length;
      const fullText = codeSnippets[current];

      if (isDeleting()) {
        setText(fullText.substring(0, text().length - 1));
      } else {
        setText(fullText.substring(0, text().length + 1));
      }

      let speed = isDeleting() ? deletingSpeed : typingSpeed;

      if (!isDeleting() && text() === fullText) {
        speed = pauseTime;
        setIsDeleting(true);
      } else if (isDeleting() && text() === "") {
        setIsDeleting(false);
        setLoopNum(loopNum() + 1);
      }

      setTimeout(type, speed);
    };

    setTimeout(type, props.index * 500);
  });

  return <div>{text()}</div>;
}

export default function CodeBackground() {
  return (
    <div class="absolute inset-0 overflow-hidden z-19">
      {/* Scrolling code lines */}
      <For each={Array.from({ length: 15 })}>
        {(item, i) => {
          const index = i();
          const fontSize = Math.random() > 0.7 ? "text-sm" : "text-xs";
          const colors = [
            "text-green-400",
            "text-cyan-400",
            "text-primary-500",
            "text-secondary-300",
          ];
          const color = colors[Math.floor(Math.random() * colors.length)];

          return (
            <div
              class={`absolute whitespace-nowrap font-mono ${fontSize} ${color}`}
              style={{
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 20}%`,
                animation: `scroll-horizontal ${10 + Math.random() * 20}s linear infinite`,
                "animation-delay": `${Math.random() * 5}s`,
              }}
            >
              {codeSnippets[Math.floor(Math.random() * codeSnippets.length)]}
            </div>
          );
        }}
      </For>

      {/* Typing code lines */}
      <For each={Array.from({ length: 8 })}>
        {(item, i) => {
          const index = i();
          const fontSize = Math.random() > 0.5 ? "text-sm" : "text-xs";
          const colors = [
            "text-cyan-400",
            "text-green-400",
            "text-primary-500",
            "text-secondary-400",
          ];
          const color = colors[Math.floor(Math.random() * colors.length)];

          return (
            <div
              class={`absolute whitespace-nowrap font-mono ${fontSize} ${color}`}
              style={{
                top: `${20 + Math.random() * 60}%`,
                left: `${5 + Math.random() * 10}%`,
                "animation-delay": `${Math.random() * 3}s`,
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

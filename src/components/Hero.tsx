import Logo from "../assets/images/LogoSolo.svg?component-solid";
import { createSignal, onMount, onCleanup } from "solid-js";

function useCountUp(target: number, duration: number = 2000) {
  const [count, setCount] = createSignal(0);

  onMount(() => {
    let startTimestamp: number | null = null;
    let animationFrame: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);

      // Ease out quart
      const ease = 1 - Math.pow(1 - progress, 4);

      setCount(Math.floor(ease * target));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(step);
      }
    };

    animationFrame = requestAnimationFrame(step);

    onCleanup(() => cancelAnimationFrame(animationFrame));
  });

  return count;
}

export const Hero = () => {
  const workshops = useCountUp(5, 1500);
  const talks = useCountUp(30, 1800);
  const tracks = useCountUp(4, 1200);
  const attendees = useCountUp(800, 2500);

  return (
    <section class="">
      <div class="grid lg:grid-cols-2 gap-10 items-center px-3 md:px-0">
        <div class="fade-in">
          <div class="inline-block px-3 py-1 bg-dark-800/50 border-l-2 border-secondary-500 text-[16px] tracking-[4px] mb-8 text-secondary-200">
            19TH SEPTEMBER 2026 // SKOPJE, MK
          </div>

          <div class="flex gap-2">
            <h1 class="font-star text-5xl lg:text-7xl leading-[0.85] uppercase tracking-tighter font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-6 fade-in">
              WHAT THE
              <br />
              STACK _
            </h1>
          </div>

          <p class="max-w-md text-dark-50 text-lg font-light mb-12 leading-relaxed">
            {`>`} All things software, all things code. <br />
            {`>`}{" "}
            <span class="text-rotate">
              <span>
                <span class="text-primary-200 font-black">The web</span>
                <span class="text-secondary-200 font-black">
                  AI & Machine Learning
                </span>
                <span class="text-cyan-300 font-black">Infrastructure</span>
                <span class="text-primary-200 font-black">DevOps</span>
                <span class="font-black">Soft Skills</span>
                <span class="text-secondary-200 font-black">Startups</span>
              </span>
            </span>{" "}
            <br />
            {`>`} With the vibes to match. <br />
            {`>`} Your favorite conference is back in September!
          </p>

          <div class="flex items-center gap-4 sm:gap-6 xl:gap-8">
            <a
              href="/tickets"
              class="btn btn-primary rounded-none px-8 py-3 sm:px-12 sm:text-xl xl:px-16 xl:py-4 h-auto min-h-0 text-lg xl:text-2xl font-star [clip-path:polygon(10%_0,100%_0,90%_100%,0_100%)] hover:scale-105 transition-transform shadow-[0_0_20px_rgba(var(--color-primary-500),0.3)]"
            >
              GRAB A TICKET
            </a>
            <div class="flex flex-col">
              <span class="text-[10px] sm:text-xs uppercase tracking-widest text-dark-50">
                Entry
              </span>
              <span class="text-2xl sm:text-3xl xl:text-4xl font-bold font-mono text-secondary-300">
                50 €
              </span>
            </div>
          </div>
        </div>

        {/* The Visual Glass Panel */}
        <div class="glass-panel glass-sweep rounded-[40px] flex items-center justify-center relative group h-full fade-in-delay-1 z-20">
          <div class="absolute w-full h-0.5 bg-secondary-400/20 animate-scan pointer-events-none" />
          <div class="w-auto h-full animate-float flex items-center justify-center p-4 opacity-90 filter drop-shadow-[0_0_15px_rgba(46,200,254,0.4)]">
            <Logo class="w-full h-full" />
          </div>
        </div>
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-12 mt-20 pt-12 border-t border-white/20 fade-in-delay-2 relative text-center lg:text-left">
        <div class="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-secondary-500/50 to-transparent"></div>
        <div
          class="group tooltip cursor-help"
          data-tip="That's at least 5. Due to the venue change, we can totally do more this time around! "
        >
          <span class="block text-sm text-secondary-300 uppercase tracking-[0.2em] mb-2 group-hover:text-primary-300 transition-colors">
            Workshops
          </span>
          <span class="text-5xl lg:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-primary-200 to-secondary-300 group-hover:from-secondary-300 group-hover:via-white group-hover:to-primary-400 transition-all duration-300 font-mono tabular-nums block">
            {workshops()}+
          </span>
        </div>
        <div
          class="group tooltip cursor-help"
          data-tip="30 of the regular ones; We have a few new ideas too!"
        >
          <span class="block text-sm text-secondary-300 uppercase tracking-[0.2em] mb-2 group-hover:text-primary-300 transition-colors">
            Talks
          </span>
          <span class="text-5xl lg:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-primary-200 to-secondary-300 group-hover:from-secondary-300 group-hover:via-white group-hover:to-primary-400 transition-all duration-300 font-mono tabular-nums block">
            {talks()}+
          </span>
        </div>
        <div
          class="group tooltip cursor-help"
          data-tip="New venue - anything is possible. As in, more!"
        >
          <span class="block text-sm text-secondary-300 uppercase tracking-[0.2em] mb-2 group-hover:text-primary-300 transition-colors">
            Tracks
          </span>
          <span class="text-5xl lg:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-primary-200 to-secondary-300 group-hover:from-secondary-300 group-hover:via-white group-hover:to-primary-400 transition-all duration-300 font-mono tabular-nums block">
            {tracks()}*
          </span>
        </div>
        <div
          class="group tooltip cursor-help"
          data-tip="Based on last year's attendance. But, if we project it, we'll probably break 1000."
        >
          <span class="block text-sm text-secondary-300 uppercase tracking-[0.2em] mb-2 group-hover:text-primary-300 transition-colors">
            Attendees
          </span>
          <span class="text-5xl lg:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-primary-200 to-secondary-300 group-hover:from-secondary-300 group-hover:via-white group-hover:to-primary-400 transition-all duration-300 font-mono tabular-nums block">
            {attendees()}+
          </span>
        </div>
      </div>
    </section>
  );
};

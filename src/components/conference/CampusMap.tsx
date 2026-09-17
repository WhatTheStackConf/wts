const CAMPUS_MAP_URL = "/static/wts-2026-campus-map.png";

export function CampusMap() {
  return (
    <figure id="venue-map" class="mt-10 border-t border-white/15 pt-8 md:mt-14 md:pt-10">
      <figcaption class="mb-6">
        <h3 class="text-2xl font-bold text-secondary-300">Find your way around</h3>
        <p class="mt-3 max-w-2xl text-base leading-relaxed text-dark-50">
          All five stages, ticket validation, coffee corners, the expo and games.
          Open the full-size campus map to zoom in or save it for the day.
        </p>
        <a
          href={CAMPUS_MAP_URL}
          class="link mt-4 inline-block text-lg font-black text-primary-200"
        >
          {`>`} Open the full-size campus map
        </a>
      </figcaption>
      <a
        href={CAMPUS_MAP_URL}
        aria-label="Open the full-size campus map"
        class="block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500"
      >
        <img
          src={CAMPUS_MAP_URL}
          alt="WTS 2026 campus map showing Stages 1–5, the entrance, ticket validation, coffee corners, expo area and game corner."
          width="1258"
          height="902"
          loading="lazy"
          decoding="async"
          class="h-auto w-full"
        />
      </a>
    </figure>
  );
}

import {
  CAMPUS_MAP_ALT,
  CAMPUS_MAP_HEIGHT,
  CAMPUS_MAP_URL,
  CAMPUS_MAP_WIDTH,
} from "~/lib/campus-map";
import { CampusMapDialog } from "~/components/conference/CampusMapDialog";

export function CampusMap() {
  return (
    <figure id="venue-map" class="mt-10 border-t border-white/15 pt-8 md:mt-14 md:pt-10">
      <figcaption class="mb-6">
        <h3 class="text-2xl font-bold text-secondary-300">Find your way around</h3>
        <p class="mt-3 max-w-2xl text-base leading-relaxed text-dark-50">
          All five stages, ticket validation, coffee corners, the expo and games.
          Open the full-size campus map to zoom in or save it for the day.
        </p>
        <div class="mt-5 flex">
          <CampusMapDialog />
        </div>
      </figcaption>
      <a
        href={CAMPUS_MAP_URL}
        rel="external"
        aria-label="Open the full-size campus map"
        class="block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500"
      >
        <img
          src={CAMPUS_MAP_URL}
          alt={CAMPUS_MAP_ALT}
          width={CAMPUS_MAP_WIDTH}
          height={CAMPUS_MAP_HEIGHT}
          loading="lazy"
          decoding="async"
          class="h-auto w-full"
        />
      </a>
    </figure>
  );
}

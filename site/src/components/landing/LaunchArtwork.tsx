export const PlanetHorizonArtwork = () => (
  <svg
    class="launch-scene__horizon"
    viewBox="0 0 1000 1000"
    fill="none"
    aria-hidden="true"
    preserveAspectRatio="none"
  >
    <defs>
      <linearGradient id="launch-horizon-body" x1="500" y1="740" x2="500" y2="1000" gradientUnits="userSpaceOnUse">
        <stop stop-color="var(--launch-sky-upper)" />
        <stop offset="0.42" stop-color="var(--launch-sky-horizon)" />
        <stop offset="0.6" stop-color="var(--launch-sky-mist)" />
        <stop offset="0.76" stop-color="color-mix(in oklch, var(--launch-sky-mist) 58%, var(--color-orbit-paper))" />
        <stop offset="0.9" stop-color="color-mix(in oklch, var(--launch-sky-mist) 18%, var(--color-orbit-paper))" />
        <stop offset="1" stop-color="var(--color-orbit-paper)" />
      </linearGradient>
      <radialGradient id="launch-horizon-light" cx="0" cy="0" r="1" gradientTransform="matrix(0 400 -720 0 500 730)" gradientUnits="userSpaceOnUse">
        <stop stop-color="var(--launch-sky-daylight)" stop-opacity="0.42" />
        <stop offset="1" stop-color="var(--launch-sky-daylight)" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="launch-horizon-rim" x1="0" y1="740" x2="1000" y2="740" gradientUnits="userSpaceOnUse">
        <stop stop-color="var(--launch-cyan)" />
        <stop offset="0.36" stop-color="var(--launch-white)" />
        <stop offset="0.5" stop-color="var(--launch-white)" />
        <stop offset="0.64" stop-color="var(--launch-cyan)" />
        <stop offset="1" stop-color="var(--launch-cyan)" />
      </linearGradient>
      <linearGradient id="launch-horizon-veil" x1="0" y1="740" x2="0" y2="900" gradientUnits="userSpaceOnUse">
        <stop stop-color="var(--launch-white)" stop-opacity="0.34" />
        <stop offset="0.14" stop-color="var(--launch-sky-daylight)" stop-opacity="0.2" />
        <stop offset="0.48" stop-color="var(--launch-sky-daylight)" stop-opacity="0.08" />
        <stop offset="1" stop-color="var(--launch-sky-daylight)" stop-opacity="0" />
      </linearGradient>
      <filter id="launch-horizon-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="9" />
      </filter>
      <linearGradient id="launch-atmosphere-clouds" x1="65" y1="840" x2="940" y2="885" gradientUnits="userSpaceOnUse">
        <stop stop-color="var(--launch-white)" stop-opacity="0" />
        <stop offset="0.2" stop-color="var(--launch-white)" stop-opacity="0.22" />
        <stop offset="0.56" stop-color="var(--launch-cyan)" stop-opacity="0.18" />
        <stop offset="0.82" stop-color="var(--launch-white)" stop-opacity="0.2" />
        <stop offset="1" stop-color="var(--launch-white)" stop-opacity="0" />
      </linearGradient>
      <filter id="launch-atmosphere-soften" x="-8%" y="-50%" width="116%" height="200%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      <clipPath id="launch-planet-clip">
        <ellipse class="launch-scene__horizon-ellipse" cx="50%" cy="122%" rx="66%" ry="48%" />
      </clipPath>
    </defs>
    <ellipse class="launch-scene__horizon-ellipse" cx="50%" cy="122%" rx="66%" ry="48%" fill="url(#launch-horizon-body)" />
    <g class="launch-scene__lower-clouds" clip-path="url(#launch-planet-clip)">
      <g filter="url(#launch-atmosphere-soften)">
        <path fill="url(#launch-atmosphere-clouds)" d="M20 850c75-31 133-60 212-44 59 12 87 40 152 28 79-15 119-62 199-55 70 6 104 48 180 39 88-11 130-47 217-44-55 22-104 67-190 73-81 5-116-35-193-28-88 9-126 67-210 71-85 4-117-36-180-31-74 5-118 36-187-9Z" />
        <path fill="url(#launch-atmosphere-clouds)" opacity=".72" d="M84 922c70-25 113-50 174-39 57 10 81 30 145 23 70-8 107-45 169-39 56 6 85 35 144 33 62-2 103-27 171-36-41 25-85 49-149 53-69 4-105-24-163-18-73 8-110 48-183 49-71 1-103-26-158-22-52 4-89 21-150-4Z" />
      </g>
    </g>
    <ellipse class="launch-scene__horizon-ellipse" cx="50%" cy="122%" rx="66%" ry="48%" fill="url(#launch-horizon-light)" />
    <ellipse class="launch-scene__horizon-ellipse" cx="50%" cy="122%" rx="66%" ry="48%" fill="url(#launch-horizon-veil)" />
    <ellipse class="launch-scene__horizon-ellipse" cx="50%" cy="122%" rx="66%" ry="48%" fill="none" stroke="var(--launch-cyan)" stroke-opacity="0.42" stroke-width="14" filter="url(#launch-horizon-glow)" />
    <ellipse class="launch-scene__horizon-ellipse" cx="50%" cy="122%" rx="66%" ry="48%" fill="none" stroke="url(#launch-horizon-rim)" stroke-width="3" />
    <ellipse class="launch-scene__horizon-ellipse" cx="50%" cy="122%" rx="66%" ry="48%" fill="none" stroke="var(--launch-white)" stroke-opacity="0.7" stroke-width="0.8" />
  </svg>
);


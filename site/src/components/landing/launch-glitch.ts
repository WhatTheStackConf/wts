/* The odd signal glitch in the launch window. A glitch is one short hit with a weaker echo,
 * fired at a station change or after a few quiet bars. At most one glitch plays per bar, so the
 * window never comes near three flashes per second (WCAG 2.3.1). */

export const BAR_MS = 2400;
export const GLITCH_MS = 120;
export const AMBIENT_BARS = [6, 14] as const;

const HIT_END = GLITCH_MS * 0.4;
const GAP_END = GLITCH_MS * 0.55;
const ECHO = 0.55;

/** Strength of a glitch `age` ms after it started: a hard hit, a clean gap, a weaker echo. */
export function glitchStrength(age: number): number {
  if (!(age >= 0) || age >= GLITCH_MS) return 0;
  if (age < HIT_END) return 1;
  return age < GAP_END ? 0 : ECHO;
}

/** Wait before the next ambient glitch: a whole number of bars inside AMBIENT_BARS. */
export function nextAmbientDelay(random: number): number {
  const [fewest, most] = AMBIENT_BARS;
  const unit = Number.isFinite(random) ? Math.min(Math.max(random, 0), 0.999_999) : 0;
  return (fewest + Math.floor(unit * (most - fewest + 1))) * BAR_MS;
}

/** A new glitch may start only one full bar after the last one. */
export function mayGlitch(now: number, lastStart: number): boolean {
  return now - lastStart >= BAR_MS;
}

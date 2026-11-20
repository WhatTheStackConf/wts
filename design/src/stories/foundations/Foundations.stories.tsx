import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { For } from "solid-js";
import { SiteSurface, Specimen } from "../../surfaces";

// Every app copies the orbit token block from site/tokens.css. These stories read the site copy.
const COLORS = [
  ["--color-orbit-paper", "Page ground. Warm ivory, never pure white."],
  ["--color-orbit-surface", "Quiet fills, disabled fields."],
  ["--color-orbit-ink", "Body text and headings."],
  ["--color-orbit-muted", "Secondary text. 4.5:1 on paper."],
  ["--color-orbit-rule", "Rules on paper."],
  ["--color-orbit-accent", "The one accent: actions, links, current state. Button fill on light surfaces."],
  ["--color-orbit-accent-ink", "Text on the accent fill."],
  ["--color-orbit-focus", "The 3px keyboard focus outline."],
  ["--color-orbit-error", "Errors and danger plates."],
  ["--color-orbit-success", "Success state."],
  ["--color-orbit-amber", "Small warm accent from the logo."],
  ["--color-orbit-magenta", "Small warm accent from the logo."],
  ["--launch-cyan", "Bright cyan. Navy surfaces only, never a fill on paper."],
  ["--color-orbit-hair", "Hairline rules (ink at 14%)."],
  ["--color-orbit-hair-strong", "Panel borders and field lines (ink at 30%)."],
] as const;

const ALTITUDES = [
  ["--alt-0", "Ground", "Auth, CFP staff, forms"],
  ["--alt-1", "Haze", "Legal, MCP, blog"],
  ["--alt-2", "Low sky", "404 pages"],
  ["--alt-3", "Mid sky", "CFP applicant pages"],
  ["--alt-4", "High sky", "Landing climb"],
  ["--alt-5", "Horizon cyan", "Landing climb"],
  ["--alt-6", "Upper", "Landing climb"],
  ["--alt-7", "Night", "Landing orbit only"],
] as const;

const meta = { title: "Foundations", parameters: { app: "site" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Color: Story = {
  render: () => <SiteSurface><div class="sb-page">
    <h1>Color</h1>
    <p>One accent, spent on actions, links and state. Status never uses color alone. Mix colors in oklab, because oklch mixes drift in hue.</p>
    <Specimen label="Orbit tokens" note="site/tokens.css">
      <For each={COLORS}>{([name, use]) => <div class="sb-swatch"><div class="sb-swatch-chip" style={{ background: `var(${name})` }} /><strong>{name.replace("--color-orbit-", "").replace("--", "")}</strong><code>{name}</code><span>{use}</span></div>}</For>
    </Specimen>
  </div></SiteSurface>,
};

export const Altitude: Story = {
  render: () => <SiteSurface><div class="sb-page">
    <h1>Altitude</h1>
    <p>Every page sits at a fixed altitude on one sky. CSS and the landing shader read the same ramp, so they cannot drift apart. Navy appears only at orbit.</p>
    <div class="sb-ramp">
      <For each={ALTITUDES}>{([name, label, use], index) => <div style={{ background: `var(${name})` }} data-dark={index() >= 5 ? "" : undefined}><strong>{label}</strong><code>{name}</code><span>{use}</span></div>}</For>
    </div>
  </div></SiteSurface>,
};

export const Typography: Story = {
  render: () => <SiteSurface><div class="sb-page">
    <h1>Typography</h1>
    <p>StarzoomShavian for page titles and the wordmark. Space Grotesk for everything else. Numbers for years and counts are tabular.</p>
    <Specimen label="Page title" note="StarzoomShavian, --text-orbit-display"><span style={{ "font-family": "var(--font-orbit-display)", "font-size": "var(--text-orbit-display)", "line-height": "1" }}>The story so far.</span></Specimen>
    <Specimen label="Section heading" note="Space Grotesk 600"><span style={{ "font-size": "var(--text-orbit-section)", "font-weight": "600" }}>What's in your stack now?</span></Specimen>
    <Specimen label="Lede" note="--text-orbit-lede"><span style={{ "font-size": "var(--text-orbit-lede)", "max-width": "40ch" }}>A tech conference for people who build products. From what to build to how it ships.</span></Specimen>
    <Specimen label="Body" note="--text-orbit-body, about 68ch"><span style={{ "max-width": "68ch" }}>Three editions, built by the community. The talks and the speakers from each one.</span></Specimen>
    <Specimen label="Label" note="Uppercase, tracked 0.14em. Names a value only."><span style={{ "font-size": "0.75rem", "font-weight": "600", "letter-spacing": "0.14em", "text-transform": "uppercase", color: "var(--color-orbit-accent)" }}>WTS 2027 · Policy</span></Specimen>
    <Specimen label="Numbers" note="font-variant-numeric: tabular-nums"><span style={{ "font-variant-numeric": "tabular-nums", "font-size": "1.75rem" }}>2024 · 2025 · 2026</span></Specimen>
  </div></SiteSurface>,
};

export const MotionAndLines: Story = {
  name: "Motion and lines",
  render: () => <SiteSurface><div class="sb-page">
    <h1>Motion and lines</h1>
    <p>Motion runs on a 100 BPM bar clock and moves in steps. Reduced motion keeps every end state. Lines are hairlines, corners are square.</p>
    <Specimen label="Eighth note" note="--dur-orbit-eighth: state changes and staggers"><div class="sb-beat" style={{ "--sb-dur": "var(--dur-orbit-eighth)" }} /></Specimen>
    <Specimen label="Beat" note="--dur-orbit-beat: reveals"><div class="sb-beat" style={{ "--sb-dur": "var(--dur-orbit-beat)" }} /></Specimen>
    <Specimen label="Bar" note="--dur-orbit-bar: ambient loops"><div class="sb-beat" style={{ "--sb-dur": "var(--dur-orbit-bar)" }} /></Specimen>
    <Specimen label="Hairlines" note="--color-orbit-hair and --color-orbit-hair-strong"><div style={{ width: "12rem", "border-top": "1px solid var(--color-orbit-hair)" }} /><div style={{ width: "12rem", "border-top": "1px solid var(--color-orbit-hair-strong)" }} /></Specimen>
    <Specimen label="Glass" note="--color-orbit-glass with --blur-orbit-glass"><div style={{ padding: "1.5rem 2rem", background: "linear-gradient(90deg, var(--alt-3), var(--alt-5))" }}><div style={{ padding: "1rem 1.5rem", border: "1px solid var(--color-orbit-hair-strong)", background: "var(--color-orbit-glass)", "backdrop-filter": "blur(var(--blur-orbit-glass))" }}>Light glass panel</div></div></Specimen>
  </div></SiteSurface>,
};

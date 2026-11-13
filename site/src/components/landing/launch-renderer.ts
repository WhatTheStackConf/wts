import { launchState, type LaunchState } from "~/components/landing/launch-model";

const MAX_PIXELS = 600_000;
const DPR_LIMIT = 1.25;
const DESKTOP_FPS = 30;
const COMPACT_FPS = 24;
const COMPACT_WIDTH = 700;
const MAX_FRAME_STEP_MS = 100;
const TIME_WRAP_SECONDS = 600;
const DEFAULT_BEAT_SECONDS = 0.6;

export interface LaunchRenderer {
  start(): void;
  stop(): void;
  setState(state: LaunchState): void;
  /** Signal glitch strength 0..1 and a seed that picks the hit rows. */
  setGlitch(strength: number, seed: number): void;
  dispose(releaseContext?: boolean): void;
}

type NumericField = { [K in keyof LaunchState]: LaunchState[K] extends number ? K : never }[keyof LaunchState];
type Rgb = readonly [number, number, number];

interface Palette {
  alt: Float32Array;
  paper: Rgb;
  surface: Rgb;
  ink: Rgb;
  cyan: Rgb;
}

const ALTITUDE_TOKENS = ["--alt-0", "--alt-1", "--alt-2", "--alt-3", "--alt-4", "--alt-5", "--alt-6", "--alt-7"];
const SINGLE_TOKENS = {
  paper: "--color-orbit-paper",
  surface: "--color-orbit-surface",
  ink: "--color-orbit-ink",
  cyan: "--launch-cyan",
} as const;

const STATE_UNIFORMS = {
  u_altitude: "altitude",
  u_horizon: "horizon",
  u_sag: "sag",
  u_ground: "ground",
  u_cloudRush: "cloudRush",
  u_cloudFloor: "cloudFloor",
  u_streaks: "streaks",
  u_streaksEdge: "streaksEdge",
  u_stars: "stars",
} as const satisfies Record<string, NumericField>;

type StateUniform = keyof typeof STATE_UNIFORMS;
type UniformName =
  | StateUniform
  | "u_resolution"
  | "u_time"
  | "u_beat"
  | "u_alt"
  | "u_paper"
  | "u_surface"
  | "u_ink"
  | "u_cyan"
  | "u_glitch"
  | "u_glitchSeed";

const UNIFORM_NAMES: readonly UniformName[] = [
  ...(Object.keys(STATE_UNIFORMS) as StateUniform[]),
  "u_resolution",
  "u_time",
  "u_beat",
  "u_alt",
  "u_paper",
  "u_surface",
  "u_ink",
  "u_cyan",
  "u_glitch",
  "u_glitchSeed",
];

const vertexShaderSource = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragmentShaderSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_beat;
uniform vec3 u_alt[8];
uniform vec3 u_paper;
uniform vec3 u_surface;
uniform vec3 u_ink;
uniform vec3 u_cyan;
uniform float u_altitude;
uniform float u_horizon;
uniform float u_sag;
uniform float u_ground;
uniform float u_cloudRush;
uniform float u_cloudFloor;
uniform float u_streaks;
uniform float u_streaksEdge;
uniform float u_stars;
uniform float u_glitch;
uniform float u_glitchSeed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
// Ordered (Bayer 4x4) dither threshold on a print cell measured in buffer pixels.
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float dots(float cell) { return bayer4(gl_FragCoord.xy / cell); }
// 1.0 or 0.0 by ordered dither. The half-step offset keeps v = 0 clean and v = 1 solid.
float screen(float v, float cell) { return step(dots(cell) + 0.03125, v); }
vec3 ramp(float x) {
  x = clamp(x, 0.0, 7.0);
  if (x < 1.0) return mix(u_alt[0], u_alt[1], x);
  if (x < 2.0) return mix(u_alt[1], u_alt[2], x - 1.0);
  if (x < 3.0) return mix(u_alt[2], u_alt[3], x - 2.0);
  if (x < 4.0) return mix(u_alt[3], u_alt[4], x - 3.0);
  if (x < 5.0) return mix(u_alt[4], u_alt[5], x - 4.0);
  if (x < 6.0) return mix(u_alt[5], u_alt[6], x - 5.0);
  return mix(u_alt[6], u_alt[7], x - 6.0);
}
float horizonAt(float x, float aspect) {
  float w = x / (0.5 * aspect + 0.2);
  return u_horizon + u_sag * (1.0 - w * w);
}
vec3 haze(vec3 col, float d) {
  float thin = smoothstep(3.6, 7.0, u_altitude);
  float band = 1.0 - smoothstep(0.0, mix(0.12, 0.05, thin), abs(d));
  // The pad stays clean. Once the ground drops, the haze prints as a dot screen.
  band = mix(band, screen(band, 2.0), 0.85 * (1.0 - u_ground));
  return mix(col, u_paper, band * mix(0.55, 0.4, thin) * step(0.0, d + 0.002));
}
vec3 underside(vec2 q, float edge, float y) {
  vec3 land = mix(u_surface, u_paper, 0.25);
  if (u_cloudFloor <= 0.0) return land;
  float depth = 1.0 / max(0.04, edge - y + 0.04);
  vec2 deck = vec2(q.x * depth * 0.9, depth * 1.2 + u_time * 0.02 * (1.0 - u_stars));
  float cover = smoothstep(0.42, 0.75, fbm(deck * 1.4));
  vec3 deep = mix(u_alt[3], u_alt[5], smoothstep(5.0, 7.0, u_altitude));
  vec3 below = mix(deep, u_paper, cover * mix(0.9, 0.55, u_stars));
  return mix(land, below, u_cloudFloor);
}
vec3 horizonLine(vec3 col, float d) {
  float line = 1.0 - smoothstep(0.0, 1.6 / u_resolution.y, abs(d));
  float weight = mix(0.35, 0.9, u_cloudFloor) * (1.0 - u_ground);
  col = mix(col, mix(u_ink, u_cyan, u_cloudFloor), line * weight);
  float rim = exp(-abs(d) * u_resolution.y / 14.0) * smoothstep(0.0, 0.02, d + 0.02);
  rim = screen(rim, 2.0);
  return col + u_cyan * 0.18 * rim * u_cloudFloor;
}
vec3 cloudRush(vec3 col, vec2 q, vec2 uv) {
  if (u_cloudRush <= 0.0) return col;
  vec2 cp = vec2(q.x * 1.6, uv.y * 0.9 + u_time * 0.9);
  float c = fbm(cp * vec2(1.0, 0.62) + 0.6 * vec2(fbm(cp * 0.8 + 3.0), fbm(cp * 0.8)));
  float density = screen(smoothstep(0.42, 0.68, c), 2.0);
  float flicker = 1.0 - 0.06 * u_cloudRush * (1.0 - step(0.5, fract(u_beat * 4.0)));
  return mix(col * flicker, u_paper, density * u_cloudRush * 0.95);
}
vec3 streaks(vec3 col, vec2 uv) {
  if (u_streaks <= 0.0) return col;
  float columns = 90.0;
  float cx = floor(uv.x * columns);
  float r = hash(vec2(cx, 7.0));
  float edgeMask = mix(1.0, smoothstep(0.28, 0.5, abs(uv.x - 0.5)), u_streaksEdge);
  float y = fract(uv.y * 0.7 + u_time * (1.2 + r * 1.8) + r * 9.0);
  float len = 0.08 + 0.12 * hash(vec2(cx, 3.0));
  float fx = abs(fract(uv.x * columns) - 0.5) * (u_resolution.x / columns);
  float s = smoothstep(1.0 - len, 1.0, y) * (1.0 - smoothstep(0.35, 1.1, fx)) * step(0.55, r);
  return mix(col, u_paper, s * u_streaks * edgeMask * 0.7);
}
vec3 stars(vec3 col, float d) {
  if (u_stars <= 0.0) return col;
  vec2 sp = gl_FragCoord.xy / 2.2;
  float r = hash(floor(sp));
  float star = step(0.993, r) * (1.0 - smoothstep(0.0, 0.9, length(fract(sp) - 0.5) * 2.0));
  star *= 0.6 + 0.4 * sin(u_time * 1.3 + r * 60.0);
  return col + u_paper * star * u_stars * smoothstep(0.0, 0.03, d);
}
vec3 encodeSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
const float GLITCH_ROWS = 48.0;
// 1.0 on the rows a glitch hits. Fewer rows are hit on the weaker echo.
float glitchRow(float y) {
  if (u_glitch <= 0.0) return 0.0;
  float r = hash(vec2(floor(y * GLITCH_ROWS), u_glitchSeed));
  return step(1.0 - 0.06 * u_glitch, r);
}
// A hit row slips a few pixels and half-prints as a dot screen in its own hue.
vec3 glitchRows(vec3 c, float hit, float y) {
  if (hit <= 0.0) return c;
  float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  vec3 crushed = c * (floor(l * 8.0 + dots(2.0)) / 8.0) / l;
  return mix(c, clamp(crushed, 0.0, 1.0), 0.5 * u_glitch);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float hit = glitchRow(uv.y);
  uv.x = fract(uv.x + hit * (hash(vec2(floor(uv.y * GLITCH_ROWS), u_glitchSeed + 3.0)) - 0.5) * 0.01 * u_glitch);
  float aspect = u_resolution.x / u_resolution.y;
  vec2 q = vec2((uv.x - 0.5) * aspect, uv.y);
  float edge = horizonAt(q.x, aspect);
  float d = uv.y - edge;
  vec3 col = mix(ramp(u_altitude - 0.4), ramp(u_altitude + 0.9), pow(uv.y, 1.15));
  col = haze(col, d);
  if (d < 0.002) col = mix(col, underside(q, edge, uv.y), 1.0 - smoothstep(-0.002, 0.002, d));
  col = horizonLine(col, d);
  col = cloudRush(col, q, uv);
  col = streaks(col, uv);
  col = stars(col, d);
  vec3 dither = vec3((hash(gl_FragCoord.xy + u_time) - 0.5) / 255.0);
  gl_FragColor = vec4(glitchRows(encodeSrgb(col), hit, uv.y) + dither, 1.0);
}`;

const LIGHTNESS_UNITS: Record<string, number> = { "": 1, "%": 0.01 };
const CHROMA_UNITS: Record<string, number> = { "": 1, "%": 0.004 };
const HUE_UNITS: Record<string, number> = { "": 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };
const COMPONENT = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|[a-z]*)$/i;
const OKLCH = /^oklch\(\s*([^\s/)]+)\s+([^\s/)]+)\s+([^\s/)]+)\s*(?:\/[^)]*)?\)$/i;

function parseComponent(text: string, units: Record<string, number>): number | undefined {
  if (text.toLowerCase() === "none") return 0;
  const match = COMPONENT.exec(text);
  const scale = match ? units[match[2].toLowerCase()] : undefined;
  return match && scale !== undefined ? Number(match[1]) * scale : undefined;
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function oklabToLinear(lightness: number, a: number, b: number): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    unit(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    unit(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    unit(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function oklchToLinear(value: string): Rgb | undefined {
  const match = OKLCH.exec(value.trim());
  if (!match) return undefined;
  const lightness = parseComponent(match[1], LIGHTNESS_UNITS);
  const chroma = parseComponent(match[2], CHROMA_UNITS);
  const hue = parseComponent(match[3], HUE_UNITS);
  if (lightness === undefined || chroma === undefined || hue === undefined) return undefined;
  const radians = (hue * Math.PI) / 180;
  return oklabToLinear(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians));
}

function srgbChannelToLinear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function createColorSampler(): (value: string) => Rgb | undefined {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  return (value) => {
    if (!context) return undefined;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "rgba(0, 0, 0, 0)";
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
    return alpha === 0 ? undefined : [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
  };
}

function readPalette(style: CSSStyleDeclaration): Palette | undefined {
  let sampler: ((value: string) => Rgb | undefined) | undefined;
  const read = (token: string) => {
    const value = style.getPropertyValue(token).trim();
    if (!value) return undefined;
    return oklchToLinear(value) ?? (sampler ??= createColorSampler())(value);
  };
  const alt = ALTITUDE_TOKENS.map(read);
  const paper = read(SINGLE_TOKENS.paper);
  const surface = read(SINGLE_TOKENS.surface);
  const ink = read(SINGLE_TOKENS.ink);
  const cyan = read(SINGLE_TOKENS.cyan);
  if (!paper || !surface || !ink || !cyan || alt.some((color) => !color)) return undefined;
  return { alt: new Float32Array(alt.flatMap((color) => color ?? [])), paper, surface, ink, cyan };
}

function readBeatSeconds(style: CSSStyleDeclaration): number {
  const match = /^([\d.]+)(ms|s)$/.exec(style.getPropertyValue("--dur-orbit-beat").trim());
  const seconds = match ? Number(match[1]) / (match[2] === "ms" ? 1000 : 1) : NaN;
  return seconds > 0 ? seconds : DEFAULT_BEAT_SECONDS;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | undefined {
  const shader = gl.createShader(type);
  if (!shader) return undefined;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return undefined;
  }
  return shader;
}

function linkProgram(gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader) {
  const program = gl.createProgram();
  if (!program) return undefined;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return undefined;
}

function createLinkedProgram(gl: WebGLRenderingContext): WebGLProgram | undefined {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = vertexShader && fragmentShader ? linkProgram(gl, vertexShader, fragmentShader) : undefined;
  if (vertexShader) gl.deleteShader(vertexShader);
  if (fragmentShader) gl.deleteShader(fragmentShader);
  return program;
}

function releaseWebGLContext(gl: WebGLRenderingContext) {
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}

interface GlResources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  uniforms: Record<UniformName, WebGLUniformLocation | null>;
}

function bindFullScreenTriangle(gl: WebGLRenderingContext, program: WebGLProgram): WebGLBuffer | undefined {
  const position = gl.getAttribLocation(program, "a_position");
  const buffer = position < 0 ? null : gl.createBuffer();
  if (!buffer) return undefined;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  return buffer;
}

function createResources(gl: WebGLRenderingContext): GlResources | undefined {
  const program = createLinkedProgram(gl);
  if (!program) return undefined;
  gl.useProgram(program);
  const buffer = bindFullScreenTriangle(gl, program);
  if (!buffer) {
    gl.deleteProgram(program);
    return undefined;
  }
  const uniforms = {} as GlResources["uniforms"];
  for (const name of UNIFORM_NAMES) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, buffer, uniforms };
}

function uploadPalette(gl: WebGLRenderingContext, uniforms: GlResources["uniforms"], palette: Palette) {
  gl.uniform3fv(uniforms.u_alt, palette.alt);
  gl.uniform3fv(uniforms.u_paper, palette.paper);
  gl.uniform3fv(uniforms.u_surface, palette.surface);
  gl.uniform3fv(uniforms.u_ink, palette.ink);
  gl.uniform3fv(uniforms.u_cyan, palette.cyan);
}

function uploadState(gl: WebGLRenderingContext, uniforms: GlResources["uniforms"], state: LaunchState) {
  for (const name of Object.keys(STATE_UNIFORMS) as StateUniform[]) {
    gl.uniform1f(uniforms[name], state[STATE_UNIFORMS[name]]);
  }
}

class SkyRenderer implements LaunchRenderer {
  private disposed = false;
  private lost = false;
  private active = false;
  private frameId = 0;
  private lastFrame = 0;
  private nextFrame = 0;
  private elapsed = 0;
  private cssWidth = 0;
  private frameInterval = 1000 / DESKTOP_FPS;
  private state: LaunchState = launchState(0);
  private stateDirty = true;
  private glitch: readonly [number, number] = [0, 0];
  private glitchDirty = false;
  private readonly observer: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGLRenderingContext,
    private readonly resources: GlResources,
    private readonly beatSeconds: number,
    private readonly onContextLost: () => void,
  ) {
    this.observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) this.resize(entry.contentRect.width, entry.contentRect.height);
    });
    this.observer.observe(canvas);
    canvas.addEventListener("webglcontextlost", this.handleLost);
  }

  start() {
    if (this.disposed || this.lost || this.active) return;
    this.active = true;
    this.lastFrame = 0;
    this.nextFrame = 0;
    this.requestFrame();
  }

  stop() {
    this.active = false;
    this.cancelFrame();
    this.lastFrame = 0;
  }

  setState(state: LaunchState) {
    this.state = state;
    this.stateDirty = true;
  }

  setGlitch(strength: number, seed: number) {
    this.glitch = [Number.isFinite(strength) ? Math.min(Math.max(strength, 0), 1) : 0, seed];
    this.glitchDirty = true;
  }

  dispose(releaseContext = false) {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.cancelFrame();
    this.observer.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    if (this.lost) return;
    this.gl.deleteBuffer(this.resources.buffer);
    this.gl.deleteProgram(this.resources.program);
    if (releaseContext) releaseWebGLContext(this.gl);
  }

  private resize(width: number, height: number) {
    if (this.disposed || width <= 0 || height <= 0) return;
    this.cssWidth = width;
    this.frameInterval = 1000 / (width < COMPACT_WIDTH ? COMPACT_FPS : DESKTOP_FPS);
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
    const pixelScale = Math.min(dpr, Math.sqrt(MAX_PIXELS / (width * height)));
    const bufferWidth = Math.max(1, Math.floor(width * pixelScale));
    const bufferHeight = Math.max(1, Math.floor(height * pixelScale));
    if (this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight) {
      this.canvas.width = bufferWidth;
      this.canvas.height = bufferHeight;
    }
    this.gl.viewport(0, 0, bufferWidth, bufferHeight);
    this.gl.uniform2f(this.resources.uniforms.u_resolution, bufferWidth, bufferHeight);
    this.requestFrame();
  }

  private readonly handleLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.active = false;
    this.cancelFrame();
    this.onContextLost();
  };

  private canDraw() {
    return this.active && !this.disposed && !this.lost && this.cssWidth > 0;
  }

  private requestFrame() {
    if (this.canDraw() && !this.frameId) this.frameId = requestAnimationFrame(this.draw);
  }

  private cancelFrame() {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
  }

  private advanceClock(timestamp: number) {
    const delta = this.lastFrame ? Math.min(timestamp - this.lastFrame, MAX_FRAME_STEP_MS) : 0;
    this.elapsed = (this.elapsed + delta / 1000) % TIME_WRAP_SECONDS;
    this.lastFrame = timestamp;
    // Keep the deadline phase stable across display refresh rates.
    this.nextFrame = this.nextFrame
      ? timestamp - ((timestamp - this.nextFrame) % this.frameInterval) + this.frameInterval
      : timestamp + this.frameInterval;
  }

  private readonly draw = (timestamp: number) => {
    this.frameId = 0;
    if (!this.canDraw()) return;
    if (timestamp + 0.5 >= this.nextFrame) this.render(timestamp);
    this.requestFrame();
  };

  private render(timestamp: number) {
    const { gl, resources } = this;
    this.advanceClock(timestamp);
    if (this.stateDirty) uploadState(gl, resources.uniforms, this.state);
    this.stateDirty = false;
    if (this.glitchDirty) this.uploadGlitch();
    gl.uniform1f(resources.uniforms.u_time, this.elapsed);
    gl.uniform1f(resources.uniforms.u_beat, this.elapsed / this.beatSeconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private uploadGlitch() {
    this.gl.uniform1f(this.resources.uniforms.u_glitch, this.glitch[0]);
    this.gl.uniform1f(this.resources.uniforms.u_glitchSeed, this.glitch[1]);
    this.glitchDirty = false;
  }
}

function abandon(gl: WebGLRenderingContext): undefined {
  releaseWebGLContext(gl);
  return undefined;
}

export function createLaunchRenderer(
  canvas: HTMLCanvasElement,
  onContextLost: () => void,
): LaunchRenderer | undefined {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return undefined;
  const style = getComputedStyle(canvas);
  const palette = readPalette(style);
  if (!palette) return abandon(gl);
  const resources = createResources(gl);
  if (!resources) return abandon(gl);
  uploadPalette(gl, resources.uniforms, palette);
  return new SkyRenderer(canvas, gl, resources, readBeatSeconds(style), onContextLost);
}

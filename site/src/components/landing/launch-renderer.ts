const MAX_PIXELS = 600_000;
const DPR_LIMIT = 1.25;


export interface LaunchRenderer {
  start(): void;
  stop(): void;
  dispose(releaseContext?: boolean): void;
}

const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragmentShaderSource = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec3 u_cyan;
uniform vec4 u_geometry;
void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);
  float x = p.x;
  float ellipseX = (x - u_geometry.x) / u_geometry.z;
  float valid = 1.0 - smoothstep(0.985, 1.0, abs(ellipseX));
  float horizonY = u_geometry.y - u_geometry.w * sqrt(max(0.0, 1.0 - ellipseX * ellipseX));
  float distanceToRim = p.y - horizonY;
  float core = exp(-abs(distanceToRim) * 950.0) * valid;
  float innerHalo = exp(-abs(distanceToRim - 0.003) * 245.0) * valid;
  float outerHalo = exp(-abs(distanceToRim - 0.011) * 68.0) * valid;
  float phase = fract(u_time / 22.0);
  float travel = min(abs(x - phase), 1.0 - abs(x - phase));
  float energy = exp(-travel * travel / 0.0032);
  float wisp = 0.5 + 0.5 * sin(x * 25.0 - u_time * 0.68);
  float light = energy * 0.72 + wisp * 0.07;
  float alpha = clamp(
    core * (0.3 + light) +
    innerHalo * (0.12 + energy * 0.3) +
    outerHalo * (0.065 + energy * 0.2),
    0.0,
    0.42
  );
  vec3 rimColor = mix(u_cyan, vec3(1.0), energy * 0.58);
  vec3 color = rimColor * alpha;
  gl_FragColor = vec4(color, alpha);
}`;
function readCssColor(canvas: HTMLCanvasElement, token: string, fallback: [number, number, number]): [number, number, number] {
  const color = getComputedStyle(canvas).getPropertyValue(token).trim();
  const sample = document.createElement("canvas");
  sample.width = 1;
  sample.height = 1;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context || !color) return fallback;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1).data;
  return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
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


function releaseWebGLContext(gl: WebGLRenderingContext) {
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}

export function createLaunchRenderer(
  canvas: HTMLCanvasElement,
  onContextLost: () => void,
): LaunchRenderer | undefined {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return undefined;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    releaseWebGLContext(gl);
    return undefined;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    releaseWebGLContext(gl);
    return undefined;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    releaseWebGLContext(gl);
    return undefined;
  }

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    releaseWebGLContext(gl);
    return undefined;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const timeLocation = gl.getUniformLocation(program, "u_time");
  const cyanLocation = gl.getUniformLocation(program, "u_cyan");
  const geometryLocation = gl.getUniformLocation(program, "u_geometry");
  if (positionLocation < 0 || !timeLocation || !cyanLocation || !geometryLocation) {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    releaseWebGLContext(gl);
    return undefined;
  }

  gl.useProgram(program);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  const cyan = readCssColor(canvas, "--launch-cyan", [0.31, 0.80, 0.89]);
  gl.uniform3f(cyanLocation, cyan[0], cyan[1], cyan[2]);
  gl.clearColor(0, 0, 0, 0);

  let disposed = false;
  let lost = false;
  let active = false;
  let frameId = 0;
  let lastFrame = 0;
  let nextFrame = 0;
  let elapsed = 0;
  let cssWidth = 0;
  let frameInterval = 1000 / 30;
  const updateFrameInterval = () => {
    frameInterval = 1000 / (Math.min(cssWidth, window.innerWidth) < 520 ? 24 : 30);
  };

  const resize = (width: number, height: number) => {
    if (disposed || width <= 0 || height <= 0) return;
    cssWidth = width;
    updateFrameInterval();
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
    const pixelScale = Math.min(dpr, Math.sqrt(MAX_PIXELS / (width * height)));
    const bufferWidth = Math.max(1, Math.floor(width * pixelScale));
    const bufferHeight = Math.max(1, Math.floor(height * pixelScale));
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
      gl.viewport(0, 0, bufferWidth, bufferHeight);
    }
    const mobile = width < 768;
    gl.uniform4f(geometryLocation, 0.5, mobile ? 0.9 : 1.22, 0.66, mobile ? 0.16 : 0.48);
    requestFrame();
  };

  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry) resize(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(canvas);
  window.addEventListener("resize", updateFrameInterval);

  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    active = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    onContextLost();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  const draw = (timestamp: number) => {
    frameId = 0;
    if (disposed || lost || !active || !cssWidth) return;
    if (timestamp + 0.5 < nextFrame) {
      frameId = requestAnimationFrame(draw);
      return;
    }
    const delta = lastFrame ? Math.min(timestamp - lastFrame, 100) : 0;
    elapsed += delta / 1000;
    lastFrame = timestamp;
    // Keep the deadline phase stable across display refresh rates.
    nextFrame = nextFrame
      ? timestamp - (timestamp - nextFrame) % frameInterval + frameInterval
      : timestamp + frameInterval;
    gl.uniform1f(timeLocation, elapsed);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frameId = requestAnimationFrame(draw);
  };
  const requestFrame = () => {
    if (active && !disposed && !lost && !frameId && cssWidth > 0) {
      frameId = requestAnimationFrame(draw);
    }
  };

  return {
    start() {
      if (disposed || lost || active) return;
      active = true;
      lastFrame = 0;
      nextFrame = 0;
      requestFrame();
    },
    stop() {
      active = false;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      lastFrame = 0;
    },
    dispose(releaseContext = false) {
      if (disposed) return;
      disposed = true;
      active = false;
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateFrameInterval);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      if (!lost) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        if (releaseContext) releaseWebGLContext(gl);
      }
      frameId = 0;
    },
  };
}

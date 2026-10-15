import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createLaunchRenderer } from "./launch-renderer";

type Failure = "vertex" | "fragment" | "both" | "program" | "link" | "buffer" | "uniform" | "attribute";

function fakeGl(failure: Failure | undefined, calls: unknown[][]) {
  const results: Record<string, (...args: unknown[]) => unknown> = {
    createShader: (type) => `shader:${String(type)}`,
    getShaderParameter: (shader) => !(
      (failure === "vertex" || failure === "both") && shader === "shader:VERTEX_SHADER"
      || (failure === "fragment" || failure === "both") && shader === "shader:FRAGMENT_SHADER"
    ),
    createProgram: () => failure === "program" ? null : "program",
    getProgramParameter: () => failure !== "link",
    createBuffer: () => failure === "buffer" ? null : "buffer",
    getAttribLocation: () => failure === "attribute" ? -1 : 0,
    getUniformLocation: (_program, name) => failure === "uniform" && name === "u_cyan" ? null : `uniform:${String(name)}`,
    getExtension: () => ({ loseContext: () => calls.push(["loseContext"]) }),
  };
  return new Proxy({}, {
    get: (_target, property: string) => {
      if (/^[A-Z_]+$/.test(property)) return property;
      return (...args: unknown[]) => {
        calls.push([property, ...args]);
        return results[property]?.(...args);
      };
    },
  });
}

function canvasFor(failure: Failure | undefined, calls: unknown[][], context = true) {
  return {
    width: 0,
    height: 0,
    getContext: (kind: string, options: unknown) => {
      calls.push(["getContext", kind, options]);
      return context ? fakeGl(failure, calls) : null;
    },
    addEventListener: (name: string) => calls.push(["canvas.addEventListener", name]),
    removeEventListener: (name: string) => calls.push(["canvas.removeEventListener", name]),
  } as unknown as HTMLCanvasElement;
}

const compile = [
  ["createShader", "VERTEX_SHADER"], ["shaderSource", "shader:VERTEX_SHADER", expect.any(String)], ["compileShader", "shader:VERTEX_SHADER"], ["getShaderParameter", "shader:VERTEX_SHADER", "COMPILE_STATUS"],
];
const compileFragment = [
  ["createShader", "FRAGMENT_SHADER"], ["shaderSource", "shader:FRAGMENT_SHADER", expect.any(String)], ["compileShader", "shader:FRAGMENT_SHADER"], ["getShaderParameter", "shader:FRAGMENT_SHADER", "COMPILE_STATUS"],
];
const link = [
  ["createProgram"], ["attachShader", "program", "shader:VERTEX_SHADER"], ["attachShader", "program", "shader:FRAGMENT_SHADER"], ["linkProgram", "program"],
  ["deleteShader", "shader:VERTEX_SHADER"], ["deleteShader", "shader:FRAGMENT_SHADER"], ["getProgramParameter", "program", "LINK_STATUS"],
];
const geometry = [
  ["createBuffer"], ["bindBuffer", "ARRAY_BUFFER", "buffer"], ["bufferData", "ARRAY_BUFFER", expect.any(Float32Array), "STATIC_DRAW"],
  ["getAttribLocation", "program", "a_position"], ["getUniformLocation", "program", "u_time"], ["getUniformLocation", "program", "u_cyan"], ["getUniformLocation", "program", "u_geometry"],
];
const context = ["getContext", "webgl", { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" }];

let calls: unknown[][];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
  vi.stubGlobal("ResizeObserver", class { observe(target: unknown) { calls.push(["observe", target === undefined]); } disconnect() { calls.push(["disconnect"]); } });
  vi.stubGlobal("window", {
    innerWidth: 1024,
    devicePixelRatio: 1,
    addEventListener: (name: string) => calls.push(["window.addEventListener", name]),
    removeEventListener: (name: string) => calls.push(["window.removeEventListener", name]),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createLaunchRenderer resource cleanup", () => {
  it("returns nothing without a WebGL context", () => {
    expect(createLaunchRenderer(canvasFor(undefined, calls, false), vi.fn())).toBeUndefined();
    expect(calls).toEqual([context]);
  });

  it.each([
    ["vertex", [["deleteShader", "shader:FRAGMENT_SHADER"]]],
    ["fragment", [["deleteShader", "shader:VERTEX_SHADER"]]],
    ["both", []],
  ] as const)("releases the context when the %s shader fails to compile", (failure, deletes) => {
    expect(createLaunchRenderer(canvasFor(failure, calls), vi.fn())).toBeUndefined();
    const vertexDeleted = failure === "vertex" || failure === "both" ? [["deleteShader", "shader:VERTEX_SHADER"]] : [];
    const fragmentDeleted = failure === "fragment" || failure === "both" ? [["deleteShader", "shader:FRAGMENT_SHADER"]] : [];
    expect(calls).toEqual([context, ...compile, ...vertexDeleted, ...compileFragment, ...fragmentDeleted, ...deletes, ["getExtension", "WEBGL_lose_context"], ["loseContext"]]);
  });

  it("deletes both shaders when no program can be created", () => {
    expect(createLaunchRenderer(canvasFor("program", calls), vi.fn())).toBeUndefined();
    expect(calls).toEqual([context, ...compile, ...compileFragment, ["createProgram"], ["deleteShader", "shader:VERTEX_SHADER"], ["deleteShader", "shader:FRAGMENT_SHADER"], ["getExtension", "WEBGL_lose_context"], ["loseContext"]]);
  });

  it("deletes the program when linking fails", () => {
    expect(createLaunchRenderer(canvasFor("link", calls), vi.fn())).toBeUndefined();
    expect(calls).toEqual([context, ...compile, ...compileFragment, ...link, ["deleteProgram", "program"], ["getExtension", "WEBGL_lose_context"], ["loseContext"]]);
  });

  it("deletes the program when no buffer can be created", () => {
    expect(createLaunchRenderer(canvasFor("buffer", calls), vi.fn())).toBeUndefined();
    expect(calls).toEqual([context, ...compile, ...compileFragment, ...link, ["createBuffer"], ["deleteProgram", "program"], ["getExtension", "WEBGL_lose_context"], ["loseContext"]]);
  });

  it.each(["uniform", "attribute"] as const)("deletes the buffer and program when a %s location is missing", (failure) => {
    expect(createLaunchRenderer(canvasFor(failure, calls), vi.fn())).toBeUndefined();
    expect(calls).toEqual([context, ...compile, ...compileFragment, ...link, ...geometry, ["deleteBuffer", "buffer"], ["deleteProgram", "program"], ["getExtension", "WEBGL_lose_context"], ["loseContext"]]);
  });

  it("binds the geometry, starts listening, and releases everything on dispose", () => {
    const renderer = createLaunchRenderer(canvasFor(undefined, calls), vi.fn());
    expect(renderer).toBeDefined();
    renderer!.dispose(true);
    expect(calls).toEqual([
      context, ...compile, ...compileFragment, ...link, ...geometry,
      ["useProgram", "program"], ["enableVertexAttribArray", 0], ["vertexAttribPointer", 0, 2, "FLOAT", false, 0, 0],
      ["uniform3f", "uniform:u_cyan", 0.31, 0.8, 0.89], ["clearColor", 0, 0, 0, 0],
      ["observe", false], ["window.addEventListener", "resize"], ["canvas.addEventListener", "webglcontextlost"],
      ["window.removeEventListener", "resize"], ["disconnect"], ["canvas.removeEventListener", "webglcontextlost"],
      ["deleteBuffer", "buffer"], ["deleteProgram", "program"], ["getExtension", "WEBGL_lose_context"], ["loseContext"],
    ]);
  });
});

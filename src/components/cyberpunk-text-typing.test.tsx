import { renderToString } from "@solidjs/web";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const writes = vi.hoisted(() => [] as Array<[number, unknown]>);

vi.mock("solid-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("solid-js")>();
  return {
    ...actual,
    onSettled: (effect: () => void) => effect(),
    createSignal: (value: unknown, options?: unknown) => {
      const [read, write] = (actual.createSignal as (value: unknown, options?: unknown) => [() => unknown, (next: unknown) => unknown])(value, options);
      return [read, (next: unknown) => {
        writes.push([Date.now(), next]);
        return write(next);
      }];
    },
  };
});

import { CyberpunkText } from "./CyberpunkText";
import MultiLineCyberpunkText from "./MultiLineCyberpunkText";

const text = (html: string) => html.replace(/<!--.*?-->/g, "");

beforeEach(() => {
  writes.length = 0;
  vi.useFakeTimers({ now: 0 });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CyberpunkText typing", () => {
  it("types one line at 150 ms per character, then shows the effect after one second", () => {
    const done = vi.fn();
    createRoot(() => CyberpunkText({ text: "Hey", delay: 100, onTypingComplete: done }));
    vi.advanceTimersByTime(1699);
    expect(writes).toEqual([[250, "H"], [400, "He"], [550, "Hey"], [700, true]]);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([[250, "H"], [400, "He"], [550, "Hey"], [700, true], [1700, true]]);
  });

  it("types the first line, pauses, types the second line, then shows the effect", () => {
    const done = vi.fn();
    createRoot(() => CyberpunkText({ text: "unused", isWhatTheStack: true, firstLineText: "Ab", secondLineText: "C", onTypingComplete: done }));
    vi.advanceTimersByTime(10_000);
    expect(writes).toEqual([[150, "A"], [300, "Ab"], [950, false], [950, ""], [1100, "C"], [2250, true]]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("falls back to single-line typing without both lines and does nothing when disabled", () => {
    createRoot(() => CyberpunkText({ text: "Z", isWhatTheStack: true, firstLineText: "Ab" }));
    vi.advanceTimersByTime(10_000);
    expect(writes).toEqual([[150, "Z"], [300, true], [1300, true]]);
    writes.length = 0;
    createRoot(() => CyberpunkText({ text: "Z", disabled: true }));
    vi.advanceTimersByTime(10_000);
    expect(writes).toEqual([]);
  });

  it("renders the initial markup for each text mode", () => {
    expect(text(renderToString(() => <CyberpunkText text="Hey" className="big" hasGlow tracking="tracking-wide" />))).toBe(
      '<span class="relative big"><span class="relative neon-glow-subtle"><span class="ml-0.5 inline-block w-1 h-6 bg-current align-middle animate-pulse"></span></span></span>',
    );
    expect(text(renderToString(() => <CyberpunkText text="2027" isYear tracking="tracking-wide" />))).toBe(
      '<span class="relative "><span class="relative "><span class="text-primary-500 tracking-wide"></span><span class="ml-0.5 inline-block w-1 h-6 bg-current align-middle animate-pulse"></span></span></span>',
    );
    expect(text(renderToString(() => <CyberpunkText text="x" isWhatTheStack firstLineText="WhatTheStack" secondLineText="2027" />))).toBe(
      '<span class="relative "><span class="relative "><div class="flex flex-col"><div><span class="text-secondary-300"></span><span class="text-primary-500"></span><span class="text-secondary-300"></span><span class="ml-0.5 inline-block w-1 h-6 bg-current align-middle animate-pulse"></span></div></div></span></span>',
    );
  });
});

describe("MultiLineCyberpunkText typing", () => {
  it("types both lines with the same timing and no completion effect callback", () => {
    createRoot(() => MultiLineCyberpunkText({ firstLineText: "Ab", secondLineText: "C", delay: 50 }));
    vi.advanceTimersByTime(10_000);
    expect(writes).toEqual([[200, "A"], [350, "Ab"], [1000, false], [1000, ""], [1150, "C"], [2300, true]]);
  });

  it("does not type when animation is disabled", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => "false" });
    createRoot(() => MultiLineCyberpunkText({ firstLineText: "Ab", secondLineText: "C" }));
    vi.advanceTimersByTime(10_000);
    expect(writes).toEqual([]);
  });
});

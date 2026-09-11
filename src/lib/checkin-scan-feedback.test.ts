import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createScanFeedback } from "~/lib/checkin-scan-feedback";

function mockBrowser() {
  const oscillators: ReturnType<typeof makeOscillator>[] = [];
  const gains: ReturnType<typeof makeGain>[] = [];
  function makeOscillator() {
    return {
      type: "sine",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    };
  }
  function makeGain() {
    return {
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  const context = {
    state: "suspended",
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
    createOscillator: vi.fn(() => {
      const node = makeOscillator();
      oscillators.push(node);
      return node;
    }),
    createGain: vi.fn(() => {
      const node = makeGain();
      gains.push(node);
      return node;
    }),
  };
  const AudioContext = vi.fn(function () {
    return context;
  });
  const vibrate = vi.fn(() => true);
  vi.stubGlobal("window", { AudioContext });
  vi.stubGlobal("navigator", { vibrate });
  return { AudioContext, context, oscillators, gains, vibrate };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scan feedback", () => {
  it("tears down an unused controller without requesting audio or cancelling unrelated vibration", async () => {
    const { AudioContext, vibrate } = mockBrowser();
    const feedback = createScanFeedback();
    feedback.dispose();
    await feedback.unlock();
    feedback.notify("captured", "disposed");
    expect(AudioContext).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("preserves exact keys rather than trimming or normalizing distinct attempts", () => {
    const { vibrate } = mockBrowser();
    const feedback = createScanFeedback();
    for (const key of ["attempt", " attempt", "attempt ", "ATTEMPT", "", "success:attempt"]) {
      feedback.notify("captured", key);
      feedback.notify("captured", key);
    }
    expect(vibrate).toHaveBeenCalledTimes(6);
    feedback.dispose();
  });

  it("disconnects the whole graph when starting a connected oscillator throws", async () => {
    const { context, oscillators, gains } = mockBrowser();
    const makeOscillator = context.createOscillator.getMockImplementation()!;
    context.createOscillator.mockImplementationOnce(() => {
      const oscillator = makeOscillator();
      oscillator.start.mockImplementationOnce(() => {
        throw new Error("NotAllowedError");
      });
      return oscillator;
    });
    const feedback = createScanFeedback();
    await feedback.unlock();
    expect(() => feedback.notify("success", "cannot-start")).not.toThrow();
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].stop).toHaveBeenCalledWith();
    expect(oscillators[0].disconnect).toHaveBeenCalledTimes(1);
    expect(gains[0].disconnect).toHaveBeenCalledTimes(1);
    context.close.mockImplementationOnce(() => {
      throw new Error("Already closed");
    });
    expect(() => feedback.dispose()).not.toThrow();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("keeps haptics usable without WebAudio and audio usable without vibration", async () => {
    const { oscillators, vibrate, AudioContext } = mockBrowser();
    vi.stubGlobal("window", {});
    const silent = createScanFeedback();
    await expect(silent.unlock()).resolves.toBeUndefined();
    silent.notify("captured", "no-audio");
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(AudioContext).not.toHaveBeenCalled();
    silent.dispose();

    vi.stubGlobal("window", { AudioContext });
    vi.stubGlobal("navigator", {});
    const noHaptics = createScanFeedback();
    await noHaptics.unlock();
    expect(() => noHaptics.notify("captured", "no-vibration")).not.toThrow();
    expect(oscillators).toHaveLength(1);
    noHaptics.dispose();
  });

  it("swallows constructor rejection and permits a later gesture to retry", async () => {
    const { AudioContext, oscillators, vibrate } = mockBrowser();
    AudioContext.mockImplementationOnce(() => {
      throw new Error("Unavailable");
    });
    const feedback = createScanFeedback();
    await expect(feedback.unlock()).resolves.toBeUndefined();
    expect(() => feedback.notify("captured", "unavailable")).not.toThrow();
    expect(oscillators).toHaveLength(0);
    expect(vibrate).toHaveBeenCalledWith(15);
    await feedback.unlock();
    feedback.notify("success", "unavailable");
    expect(oscillators).toHaveLength(2);
    feedback.dispose();
  });

  it("swallows rejected and throwing resumes, and retries only on a new unlock", async () => {
    const { context, oscillators } = mockBrowser();
    context.resume.mockRejectedValueOnce(new Error("NotAllowedError"));
    const feedback = createScanFeedback();
    await expect(feedback.unlock()).resolves.toBeUndefined();
    feedback.notify("captured", "blocked");
    expect(oscillators).toHaveLength(0);
    expect(context.resume).toHaveBeenCalledTimes(1);
    context.resume.mockImplementationOnce(() => {
      throw new Error("Closed");
    });
    await expect(feedback.unlock()).resolves.toBeUndefined();
    await feedback.unlock();
    feedback.notify("success", "blocked");
    expect(oscillators).toHaveLength(2);
    context.state = "suspended";
    feedback.notify("captured", "backgrounded");
    expect(context.resume).toHaveBeenCalledTimes(3);
    expect(oscillators).toHaveLength(2);
    await feedback.unlock();
    feedback.notify("captured", "backgrounded");
    expect(oscillators).toHaveLength(2);
    feedback.dispose();
  });

  it("does not suppress sound or retry feedback when vibration throws or returns false", async () => {
    const { vibrate, oscillators } = mockBrowser();
    const feedback = createScanFeedback();
    await feedback.unlock();
    vibrate.mockImplementationOnce(() => {
      throw new Error("Denied");
    });
    expect(() => feedback.notify("captured", "throw")).not.toThrow();
    feedback.notify("captured", "throw");
    expect(oscillators).toHaveLength(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
    vibrate.mockReturnValue(false);
    feedback.notify("success", "false");
    expect(oscillators).toHaveLength(3);
    expect(() => feedback.dispose()).not.toThrow();
  });

  it("handles promise-rejecting vibration shims without an unhandled rejection", async () => {
    const { oscillators } = mockBrowser();
    const vibrate = vi.fn(async () => {
      throw new Error("Denied");
    });
    vi.stubGlobal("navigator", { vibrate });
    const feedback = createScanFeedback();
    await feedback.unlock();
    feedback.notify("captured", "shim");
    feedback.dispose();
    // Drain handlers; Vitest also fails the suite on unhandled rejections.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(oscillators).toHaveLength(1);
    expect(vibrate).toHaveBeenLastCalledWith(0);
  });

  it("cleans partial scheduling failures, retaining haptics and dedupe", async () => {
    const { context, oscillators, vibrate } = mockBrowser();
    context.createGain.mockImplementationOnce(() => {
      throw new Error("No audio nodes");
    });
    const feedback = createScanFeedback();
    await feedback.unlock();
    expect(() => feedback.notify("captured", "failed-node")).not.toThrow();
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(oscillators[0].stop).toHaveBeenCalledWith();
    expect(oscillators[0].disconnect).toHaveBeenCalledTimes(1);
    expect(oscillators[0].onended).toBeNull();
    feedback.notify("captured", "failed-node");
    expect(oscillators).toHaveLength(1);
    feedback.notify("success", "failed-node");
    expect(oscillators).toHaveLength(3);
    feedback.dispose();
  });

  it("disconnects ended tones, replaces ongoing cues and cancels scheduled audio on dispose", async () => {
    const { context, oscillators, gains, vibrate, AudioContext } = mockBrowser();
    const feedback = createScanFeedback();
    await feedback.unlock();
    feedback.notify("captured", "ended");
    oscillators[0].onended?.();
    expect(oscillators[0].disconnect).toHaveBeenCalledTimes(1);
    expect(gains[0].disconnect).toHaveBeenCalledTimes(1);
    feedback.notify("success", "ongoing");
    expect(oscillators[0].stop).toHaveBeenCalledTimes(1);
    feedback.notify("error", "replacement");
    for (const index of [1, 2]) {
      expect(oscillators[index].stop).toHaveBeenLastCalledWith();
      expect(oscillators[index].disconnect).toHaveBeenCalledTimes(1);
      expect(gains[index].disconnect).toHaveBeenCalledTimes(1);
    }
    feedback.dispose();
    for (const index of [3, 4]) {
      expect(oscillators[index].stop).toHaveBeenLastCalledWith();
      expect(oscillators[index].disconnect).toHaveBeenCalledTimes(1);
      expect(gains[index].disconnect).toHaveBeenCalledTimes(1);
      expect(oscillators[index].onended).toBeNull();
    }
    expect(vibrate).toHaveBeenLastCalledWith(0);
    expect(context.close).toHaveBeenCalledTimes(1);
    vibrate.mockClear();
    feedback.dispose();
    feedback.notify("captured", "after-dispose");
    await feedback.unlock();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(AudioContext).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(5);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("continues cleanup even if stop, disconnect, vibration and close reject", async () => {
    const { context, oscillators, gains, vibrate } = mockBrowser();
    const feedback = createScanFeedback();
    await feedback.unlock();
    feedback.notify("success", "cleanup-fails");
    oscillators[0].stop.mockImplementation(() => {
      throw new Error("Already stopped");
    });
    oscillators[0].disconnect.mockImplementation(() => {
      throw new Error("Disconnected");
    });
    vibrate.mockImplementation(() => {
      throw new Error("Denied");
    });
    context.close.mockRejectedValueOnce(new Error("Closed"));
    expect(() => feedback.dispose()).not.toThrow();
    expect(gains[0].disconnect).toHaveBeenCalledTimes(1);
    expect(oscillators[1].disconnect).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  it.each(["resolve", "reject"] as const)(
    "never resurrects disposed audio when pending unlock later %ss",
    async (settlement) => {
      const { context, AudioContext, oscillators, vibrate } = mockBrowser();
      const resumed = Promise.withResolvers<void>();
      context.resume.mockImplementationOnce(() => resumed.promise);
      const feedback = createScanFeedback();
      const unlocked = feedback.unlock();
      feedback.notify("captured", "pending");
      feedback.dispose();
      vibrate.mockClear();
      if (settlement === "resolve") resumed.resolve();
      else resumed.reject(new Error("Disposed while resuming"));
      await expect(unlocked).resolves.toBeUndefined();
      feedback.notify("success", "pending");
      await feedback.unlock();
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(AudioContext).toHaveBeenCalledTimes(1);
      expect(oscillators).toHaveLength(0);
      expect(vibrate).not.toHaveBeenCalled();
    },
  );

  it("shares a pending unlock and drops stale notifications instead of replaying them later", async () => {
    const { context, oscillators, vibrate } = mockBrowser();
    const resumed = Promise.withResolvers<void>();
    context.resume.mockImplementationOnce(() => resumed.promise);
    const feedback = createScanFeedback();
    const first = feedback.unlock();
    const second = feedback.unlock();
    expect(context.resume).toHaveBeenCalledTimes(1);
    feedback.notify("captured", "pending");
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(oscillators).toHaveLength(0);
    context.state = "running";
    resumed.resolve();
    await Promise.all([first, second]);
    expect(oscillators).toHaveLength(0);
    feedback.notify("captured", "pending");
    expect(oscillators).toHaveLength(0);
    feedback.notify("success", "pending");
    expect(oscillators).toHaveLength(2);
    feedback.dispose();
  });
  it("deduplicates each kind/key, isolates controllers and evicts the oldest of 256 pairs", async () => {
    const { oscillators, vibrate } = mockBrowser();
    const feedback = createScanFeedback();
    await feedback.unlock();
    feedback.notify("captured", "same");
    feedback.notify("captured", "same");
    expect(oscillators).toHaveLength(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
    feedback.notify("success", "same");
    feedback.notify("success", "same");
    feedback.notify("error", "same");
    feedback.notify("error", "same");
    expect(oscillators).toHaveLength(5);
    expect(vibrate).toHaveBeenCalledTimes(3);
    feedback.notify("captured", "other");
    expect(vibrate).toHaveBeenCalledTimes(4);
    const independent = createScanFeedback();
    independent.notify("captured", "same");
    expect(vibrate).toHaveBeenCalledTimes(5);
    independent.dispose();

    const bounded = createScanFeedback();
    for (let index = 0; index < 257; index++) bounded.notify("captured", `key-${index}`);
    vibrate.mockClear();
    bounded.notify("captured", "key-256");
    bounded.notify("captured", "key-1");
    expect(vibrate).not.toHaveBeenCalled();
    bounded.notify("captured", "key-0");
    expect(vibrate).toHaveBeenCalledTimes(1);
    bounded.dispose();
    feedback.dispose();
  });
  it("schedules quiet, short and distinct capture, completed-success and error cues", async () => {
    const { context, oscillators, gains, vibrate } = mockBrowser();
    const feedback = createScanFeedback();
    await feedback.unlock();
    feedback.notify("captured", "operation");
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(660, 10);
    expect(oscillators[0].start).toHaveBeenCalledWith(10);
    expect(oscillators[0].stop).toHaveBeenCalledWith(10.055);
    expect(vibrate).toHaveBeenLastCalledWith(15);

    feedback.notify("success", "operation");
    expect(oscillators).toHaveLength(3);
    expect(oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(880, 10);
    expect(oscillators[2].frequency.setValueAtTime).toHaveBeenCalledWith(1175, 10.09);
    expect(oscillators[2].stop).toHaveBeenCalledWith(10.18);
    expect(vibrate).toHaveBeenLastCalledWith([25, 35, 25]);

    feedback.notify("error", "operation");
    expect(oscillators).toHaveLength(5);
    expect(oscillators[3].frequency.setValueAtTime).toHaveBeenCalledWith(330, 10);
    expect(oscillators[4].frequency.setValueAtTime).toHaveBeenCalledWith(220, 10.1);
    expect(oscillators[4].stop).toHaveBeenCalledWith(10.2);
    expect(vibrate).toHaveBeenLastCalledWith([60, 40, 60]);
    for (const [index, gain] of gains.entries()) {
      expect(gain.connect).toHaveBeenCalledWith(context.destination);
      expect(oscillators[index].connect).toHaveBeenCalledWith(gain);
      expect(oscillators[index].type).toBe("sine");
      expect(gain.gain.setValueAtTime.mock.calls[0][0]).toBe(0);
      expect(gain.gain.linearRampToValueAtTime.mock.calls[0][0]).toBeGreaterThan(0);
      expect(gain.gain.linearRampToValueAtTime.mock.calls[0][0]).toBeLessThanOrEqual(0.04);
      expect(gain.gain.linearRampToValueAtTime.mock.calls[1][0]).toBe(0);
    }
    feedback.dispose();
  });
  it("is SSR-safe and creates/resumes audio only synchronously inside unlock", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", undefined);
    const server = createScanFeedback();
    expect(() => server.notify("captured", "server")).not.toThrow();
    await expect(server.unlock()).resolves.toBeUndefined();
    server.dispose();

    const browser = mockBrowser();
    const feedback = createScanFeedback();
    expect(browser.AudioContext).not.toHaveBeenCalled();
    feedback.notify("captured", "before-gesture");
    expect(browser.AudioContext).not.toHaveBeenCalled();
    const unlocked = feedback.unlock();
    expect(browser.AudioContext).toHaveBeenCalledTimes(1);
    expect(browser.context.resume).toHaveBeenCalledTimes(1);
    await expect(unlocked).resolves.toBeUndefined();
    await feedback.unlock();
    expect(browser.AudioContext).toHaveBeenCalledTimes(1);
    feedback.dispose();
  });
});

export type ScanFeedbackKind = "captured" | "success" | "error";

type Tone = readonly [frequency: number, offset: number, duration: number];
const cues: Record<ScanFeedbackKind, { tones: readonly Tone[]; vibration: number | number[] }> = {
  // A neutral tick means decoded, NOT admitted. Only the caller can confirm success.
  captured: { tones: [[660, 0, 0.055]], vibration: 15 },
  success: {
    tones: [
      [880, 0, 0.075],
      [1175, 0.09, 0.09],
    ],
    vibration: [25, 35, 25],
  },
  error: {
    tones: [
      [330, 0, 0.08],
      [220, 0.1, 0.1],
    ],
    vibration: [60, 40, 60],
  },
};

function bestEffort(action: () => unknown): void {
  try {
    void Promise.resolve(action()).catch(() => {});
  } catch {
    /* Optional browser capability. */
  }
}

/**
 * Call `void feedback.unlock()` directly from the camera button's user gesture;
 * don't gate scanning on it (browser resume promises can remain pending).
 * Use an operation/attempt key, not a ticket: each kind/key is emitted at most
 * once within the last 256 pairs. Muted/suspended cues are dropped, never queued.
 * `captured` means decoded only; the caller must confirm the workflow before
 * notifying `success`. Call dispose on camera teardown/rebind.
 */
export function createScanFeedback() {
  let context: AudioContext | undefined;
  let unlocking: Promise<void> | undefined;
  let disposed = false;
  let usedVibration = false;
  const playing = new Set<() => void>();
  const seen = new Set<string>();

  function stopSounds(): void {
    for (const stop of playing) stop();
  }

  function unlock(): Promise<void> {
    if (disposed || typeof window === "undefined") return Promise.resolve();
    if (unlocking) return unlocking;
    try {
      const Audio = window.AudioContext;
      if (!Audio) return Promise.resolve();
      context ??= new Audio();
      if (context.state !== "running") {
        // Invoke resume before yielding so the camera button's activation survives.
        unlocking = context
          .resume()
          .catch(() => {})
          .finally(() => {
            unlocking = undefined;
          });
        return unlocking;
      }
    } catch {
      // Muted/unavailable audio must not block scanning.
    }
    return Promise.resolve();
  }

  function notify(kind: ScanFeedbackKind, key: string): void {
    if (disposed || typeof window === "undefined") return;
    const identity = JSON.stringify([kind, key]);
    if (seen.has(identity)) return;
    seen.add(identity);
    // FIFO, not an unbounded history of every attendee scanned during a shift.
    if (seen.size > 256) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    const cue = cues[kind];
    bestEffort(() => {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        usedVibration = true;
        return navigator.vibrate(cue.vibration);
      }
    });
    // Replace previous cues rather than layering a stale capture over a result.
    stopSounds();
    try {
      const audio = context;
      if (!audio || audio.state !== "running") return;
      const now = audio.currentTime;
      for (const [frequency, offset, duration] of cue.tones) {
        const oscillator = audio.createOscillator();
        let gain: GainNode | undefined;
        const release = () => {
          oscillator.onended = null;
          bestEffort(() => oscillator.disconnect());
          bestEffort(() => gain?.disconnect());
          playing.delete(stop);
        };
        const stop = () => {
          bestEffort(() => oscillator.stop());
          release();
        };
        playing.add(stop);
        oscillator.onended = release;
        gain = audio.createGain();
        const start = now + offset;
        const end = start + duration;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.035, start + 0.005);
        gain.gain.linearRampToValueAtTime(0, end);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(end);
      }
    } catch {
      stopSounds();
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    seen.clear();
    stopSounds();
    if (usedVibration) bestEffort(() => navigator.vibrate(0));
    bestEffort(() => context?.close());
    context = undefined;
  }

  return { unlock, notify, dispose };
}

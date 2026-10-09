/**
 * Tiny square-wave chiptune cues. Sound is opt-in; callers check the user's
 * preference before playing a cue.
 */

export type Cue = "start" | "success" | "error" | "copy";

// Each note is [frequency in Hz, duration in seconds].
const CUES: Record<Cue, ReadonlyArray<[number, number]>> = {
  start: [[440, 0.06]],
  success: [
    [523.25, 0.07],
    [659.25, 0.07],
    [783.99, 0.12],
  ],
  error: [
    [392, 0.1],
    [261.63, 0.18],
  ],
  copy: [
    [987.77, 0.05],
    [1318.51, 0.08],
  ],
};

const VOLUME = 0.06;

export type CuePlayer = (cue: Cue) => void;

/** The AudioContext is created lazily, on the first cue, inside a user gesture. */
export function createCuePlayer(): CuePlayer {
  let audioContext: AudioContext | undefined;

  return (cue) => {
    if (typeof AudioContext === "undefined") {
      return;
    }

    audioContext ??= new AudioContext();
    const context = audioContext;
    let startAt = context.currentTime;

    for (const [frequency, duration] of CUES[cue]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(VOLUME, startAt);
      gain.gain.setValueAtTime(0, startAt + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration);

      startAt += duration;
    }
  };
}

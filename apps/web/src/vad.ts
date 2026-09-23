export type VadEvent = {
  type: "start" | "end" | "audio";
  samples?: Float32Array;
};
/** 20 ms frames; retain 300 ms before onset, finish after 700 ms silence. */
export class VoiceActivity {
  active = false;
  private before: Float32Array[] = [];
  private onset = 0;
  private quiet = 0;
  private continuation = 0;
  private calibration: number[] = [];
  private noise = 0.002;
  private peak = 0;
  private levels: number[] = [];
  private frames = 0;
  reset() {
    this.active = false;
    this.before = [];
    this.onset = 0;
    this.quiet = 0;
    this.continuation = 0;
  }
  push(samples: Float32Array, playing = false): VadEvent[] {
    let energy = 0;
    for (const x of samples) energy += x * x;
    const rms = Math.sqrt(energy / samples.length);
    // Calibrate once per microphone session, retaining the normal pre-roll.
    // Never learn speech as noise while a turn is active.
    if (this.calibration.length < 15) {
      this.calibration.push(rms);
      this.before.push(samples);
      if (this.calibration.length === 15) {
        const sorted = [...this.calibration].sort((a, b) => a - b);
        this.noise = Math.max(0.001, sorted[3]!);
      }
      return [];
    }
    this.levels.push(rms);
    if (this.levels.length > 100) this.levels.shift();
    if (this.active) {
      this.peak = Math.max(this.peak, rms);
      // Track rising microphone noise even within an open turn. Only the
      // quietest frames, well below speech peaks, can raise the noise floor.
      if (this.levels.length >= 35) {
        const low = [...this.levels].sort((a, b) => a - b)[
          Math.floor(this.levels.length * 0.5)
        ]!;
        if (low < this.peak * 0.4) this.noise += (low - this.noise) * 0.08;
      }
    }
    const threshold = this.active
      ? Math.max(0.004, this.noise * 2.5)
      : Math.max(playing ? 0.035 : 0.008, this.noise * (playing ? 4 : 3.5));
    const voiced = rms > threshold;
    if (++this.frames % 50 === 0 && typeof window !== "undefined")
      console.debug(
        `voice.vad active=${this.active} rms=${rms.toFixed(4)} noise=${this.noise.toFixed(4)} threshold=${threshold.toFixed(4)}`,
      );
    if (!this.active) {
      this.before.push(samples);
      if (this.before.length > 15) this.before.shift();
      this.onset = voiced ? this.onset + 1 : 0;
      if (!voiced && !playing)
        this.noise += (rms - this.noise) * (rms < this.noise ? 0.08 : 0.01);
      if (this.onset < (playing ? 8 : 3)) return [];
      this.active = true;
      this.peak = rms;
      this.quiet = 0;
      const frames = this.before;
      this.before = [];
      return [
        { type: "start" },
        ...frames.map((samples) => ({ type: "audio" as const, samples })),
      ];
    }
    // An isolated 20–40 ms click must not restart the silence timer.
    this.continuation = voiced ? this.continuation + 1 : 0;
    this.quiet++;
    if (this.continuation >= 3) this.quiet = 0;
    if (this.quiet >= 35) {
      this.reset();
      return [{ type: "audio", samples }, { type: "end" }];
    }
    return [{ type: "audio", samples }];
  }
}
export function pcmBase64(samples: Float32Array) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++)
    pcm[i] = Math.max(-1, Math.min(1, samples[i]!)) * 32767;
  let s = "";
  for (const b of new Uint8Array(pcm.buffer)) s += String.fromCharCode(b);
  return btoa(s);
}

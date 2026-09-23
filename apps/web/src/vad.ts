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
  reset() {
    this.active = false;
    this.before = [];
    this.onset = 0;
    this.quiet = 0;
  }
  push(samples: Float32Array, playing = false): VadEvent[] {
    let energy = 0;
    for (const x of samples) energy += x * x;
    const voiced =
      Math.sqrt(energy / samples.length) > (playing ? 0.035 : 0.012);
    if (!this.active) {
      this.before.push(samples);
      if (this.before.length > 15) this.before.shift();
      this.onset = voiced ? this.onset + 1 : 0;
      if (this.onset < 3) return [];
      this.active = true;
      this.quiet = 0;
      const frames = this.before;
      this.before = [];
      return [
        { type: "start" },
        ...frames.map((samples) => ({ type: "audio" as const, samples })),
      ];
    }
    this.quiet = voiced ? 0 : this.quiet + 1;
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

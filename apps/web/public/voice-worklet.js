// PCM frames only: no network or recognition runs on the audio thread.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(480);
    this.used = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) {
      for (const value of input) {
        this.frame[this.used++] = value;
        if (this.used === 480) {
          this.port.postMessage(this.frame, [this.frame.buffer]);
          this.frame = new Float32Array(480);
          this.used = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("voice-capture", VoiceCapture);

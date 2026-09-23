export class Microphone {
  context: AudioContext | null = null;
  stream: MediaStream | null = null;
  node: AudioWorkletNode | null = null;
  source: MediaStreamAudioSourceNode | null = null;
  private generation = 0;
  async start(onFrame: (samples: Float32Array) => void) {
    const generation = ++this.generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error("microphone_unsupported");
      const permission = navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        .then((stream) => {
          if (generation !== this.generation) {
            stream.getTracks().forEach((track) => track.stop());
            throw Error("microphone_timeout");
          }
          return stream;
        });
      this.stream = await Promise.race([
        permission,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error("microphone_timeout")), 30000);
        }),
      ]);
      clearTimeout(timer);
      this.context = new AudioContext({ sampleRate: 24000 });
      await this.context.resume();
      await this.context.audioWorklet.addModule("/voice-worklet.js");
      this.source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, "voice-capture");
      this.node.port.onmessage = (e) => onFrame(e.data);
      this.source.connect(this.node);
      this.node.connect(this.context.destination);
    } catch (e) {
      clearTimeout(timer);
      this.close();
      if (e instanceof DOMException) {
        const codes: Record<string, string> = {
          NotAllowedError: "microphone_denied",
          NotFoundError: "microphone_missing",
          NotReadableError: "microphone_busy",
        };
        throw Error(codes[e.name] || "audio_unavailable");
      }
      throw e;
    }
  }
  mute(value: boolean) {
    this.stream?.getAudioTracks().forEach((t) => {
      t.enabled = !value;
    });
  }
  close() {
    this.generation++;
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close().catch(() => {});
    this.stream = null;
    this.context = null;
    this.node = null;
    this.source = null;
  }
}

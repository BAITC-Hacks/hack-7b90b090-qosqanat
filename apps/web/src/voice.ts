export type VoiceEvent = { type: string; [key: string]: any };
export class VoiceClient {
  ws: WebSocket | null = null;
  input: AudioContext | null = null;
  output: AudioContext | null = null;
  stream: MediaStream | null = null;
  processor: ScriptProcessorNode | null = null;
  source: MediaStreamAudioSourceNode | null = null;
  nodes: AudioBufferSourceNode[] = [];
  next = 0;
  endOfSpeech = 0;
  first = true;
  messageId = "";
  doneTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private token: string,
    private event: (e: VoiceEvent) => void,
    private delivered: (id: string, status: string, total?: number) => void,
  ) {}
  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/voice`,
      );
      this.ws.onopen = () =>
        this.ws!.send(JSON.stringify({ type: "auth", token: this.token }));
      this.ws.onmessage = async (msg) => {
        const e = JSON.parse(msg.data);
        if (e.type === "ping") {
          this.send({ type: "pong" });
          return;
        }
        if (e.type === "ready") resolve();
        if (e.type === "audio") {
          this.play(e.audio, e.message_id);
          return;
        }
        if (e.type === "audio_done") {
          const delay = Math.max(
            0,
            (this.next - (this.output?.currentTime || 0)) * 1000,
          );
          this.doneTimer = setTimeout(() => {
            this.delivered(e.message_id, "played");
            this.messageId = "";
            this.nodes = [];
          }, delay + 50);
        }
        if (e.type === "error") {
          this.stopCapture();
          reject(new Error(e.code));
        }
        this.event(e);
      };
      this.ws.onerror = () => reject(new Error("connection_lost"));
      this.ws.onclose = () => {
        this.stopCapture();
        this.event({ type: "disconnected" });
      };
    });
  }
  send(e: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(e));
  }
  async start() {
    this.cancelPlayback();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    await this.connect();
    this.output ??= new AudioContext({ sampleRate: 24000 });
    await this.output.resume();
    this.send({ type: "start" });
  }
  async capture() {
    if (!this.stream) return;
    this.input = new AudioContext({ sampleRate: 24000 });
    await this.input.resume();
    this.source = this.input.createMediaStreamSource(this.stream);
    this.processor = this.input.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      const f = e.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++)
        pcm[i] = Math.max(-1, Math.min(1, f[i]!)) * 32767;
      let binary = "";
      const bytes = new Uint8Array(pcm.buffer);
      for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]!);
      this.send({ type: "audio", audio: btoa(binary) });
    };
    this.source.connect(this.processor);
    this.processor.connect(this.input.destination);
  }
  stop() {
    this.stopCapture();
    this.endOfSpeech = performance.now();
    this.first = true;
    this.send({ type: "stop", turn_id: crypto.randomUUID() });
  }
  stopCapture() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.input?.close().catch(() => {});
    this.input = null;
    this.processor = null;
  }
  play(chunk: string, id: string) {
    if (!this.output) return;
    const bytes = Uint8Array.from(atob(chunk), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer);
    const buffer = this.output.createBuffer(1, pcm.length, 24000);
    const f = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 32768;
    const source = this.output.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output.destination);
    const at = Math.max(this.output.currentTime + 0.02, this.next);
    source.start(at);
    this.next = at + buffer.duration;
    this.nodes.push(source);
    this.messageId = id;
    if (this.first) {
      this.first = false;
      setTimeout(
        () =>
          this.delivered(
            id,
            "displayed",
            Math.round(performance.now() - this.endOfSpeech),
          ),
        Math.max(0, (at - this.output.currentTime) * 1000),
      );
    }
  }
  cancelPlayback() {
    if (this.doneTimer) clearTimeout(this.doneTimer);
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {}
    }
    this.nodes = [];
    this.next = 0;
    if (this.messageId) {
      this.delivered(this.messageId, "interrupted");
      this.messageId = "";
    }
  }
  cancel() {
    this.stopCapture();
    this.cancelPlayback();
    this.send({ type: "cancel" });
  }
  close() {
    this.cancel();
    this.ws?.close();
    this.ws = null;
    void this.output?.close();
    this.output = null;
  }
}
